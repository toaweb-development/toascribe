// The settings screens (M1.5; PLAN «Innstillinger, verktøy, utseende og personvern», K-190 to K-194, K-198): «Generelt», «Skriving»,
// «Lesing» and «Personvern», each a group of settings read and written with `manage_options`. Every change is audited as `settings`,
// which clears the site's whole cache (support.ts cacheTagsOf: a setting can change any page). The administrator's address is changed
// as WordPress does it (K-192): the new address gets a link, and it is used only once someone signed in with `manage_options` opens
// it; until then the old one stays.
import { generateToken, hashToken } from '@toascribe/auth'
import type { Database } from '@toascribe/db'
import { sql } from 'drizzle-orm'
import {
  CoreSettings,
  DEFAULT_CATEGORY_BASE,
  DEFAULT_TAG_BASE,
  cleanBase,
  GeneralSettings,
  ONE_TIME_LINK_HOURS,
  PermalinkSettings,
  PrivacySettings,
  ReadingSettings,
  SITE_LOCALES,
  WritingSettings,
} from '@toascribe/shared'
import type {
  GeneralSettingsResponse,
  PermalinkSettingsResponse,
  PrivacySettingsResponse,
  ReadingSettingsResponse,
  UpdateGeneralSettingsRequest,
  UpdatePermalinkSettingsRequest,
  UpdatePrivacySettingsRequest,
  UpdateReadingSettingsRequest,
  UpdateWritingSettingsRequest,
  WritingSettingsResponse,
} from '@toascribe/shared'

import type { SessionAuth } from '../lib/auth-context.ts'
import { AppError, ForbiddenError } from '../lib/errors.ts'
import { InvalidTokenError } from './account-links.ts'
import {
  findTokenForUpdate,
  insertAccountToken,
  invalidateAdminEmailTokens,
  markTokenUsed,
  pendingAdminEmail,
} from '../repositories/account-tokens.ts'
import { findContent } from '../repositories/content.ts'
import { publishingPeople } from '../repositories/public.ts'
import { inTransaction } from '../repositories/executor.ts'
import type { Executor } from '../repositories/executor.ts'
import { readSettings, writeSettings } from '../repositories/settings.ts'
import { findTaxonomy, findTerm } from '../repositories/terms.ts'
import { findRoleBySlug } from '../repositories/users.ts'
import type { MediaService } from './media.ts'
import type { RateLimiter } from './rate-limit.ts'
import { assertNotDelayed } from './support.ts'
import type { Auditor, RequestContext, SafeMail } from './support.ts'

const HOUR_MS = 60 * 60 * 1000
const ADMIN_EMAIL = CoreSettings.pick({ admin_email: true })
const PERMALINK_STATE = CoreSettings.pick({
  permalink_structure: true,
  category_base: true,
  tag_base: true,
  permalink_history: true,
})

export interface SettingsService {
  general(auth: SessionAuth): Promise<GeneralSettingsResponse>
  updateGeneral(
    auth: SessionAuth,
    request: UpdateGeneralSettingsRequest,
    ctx: RequestContext,
  ): Promise<GeneralSettingsResponse>
  confirmAdminEmail(auth: SessionAuth, token: string, ctx: RequestContext): Promise<string>
  writing(auth: SessionAuth): Promise<WritingSettingsResponse>
  updateWriting(
    auth: SessionAuth,
    request: UpdateWritingSettingsRequest,
    ctx: RequestContext,
  ): Promise<WritingSettingsResponse>
  reading(auth: SessionAuth): Promise<ReadingSettingsResponse>
  updateReading(
    auth: SessionAuth,
    request: UpdateReadingSettingsRequest,
    ctx: RequestContext,
  ): Promise<ReadingSettingsResponse>
  privacy(auth: SessionAuth): Promise<PrivacySettingsResponse>
  updatePrivacy(
    auth: SessionAuth,
    request: UpdatePrivacySettingsRequest,
    ctx: RequestContext,
  ): Promise<PrivacySettingsResponse>
  permalinks(auth: SessionAuth): Promise<PermalinkSettingsResponse>
  updatePermalinks(
    auth: SessionAuth,
    request: UpdatePermalinkSettingsRequest,
    ctx: RequestContext,
  ): Promise<PermalinkSettingsResponse>
}

/** An IANA zone the runtime knows, or UTC, or empty (WordPress «UTC+1», gmt_offset). */
function knownTimeZone(zone: string): boolean {
  if (zone === '' || zone === 'UTC') return true
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/**
 * One change of the administrator address at a time: a request and a confirmation wait for each other, so «the last request wins»
 * holds when two arrive together (each voids the links committed before it).
 */
async function lockAdminEmail(tx: Executor): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('toascribe:admin-email', 0))`)
}

/**
 * What makes a set of address rules unusable: two bases that take each other's addresses (the same, or one inside the other), a base
 * that takes the author archives or the archive pages, or a structure that starts inside a base (every post would be read as a term).
 */
export function rulesProblem(rules: {
  structure: string
  category_base: string
  tag_base: string
}): string | undefined {
  const category = cleanBase(rules.category_base, DEFAULT_CATEGORY_BASE).split('/')
  const tag = cleanBase(rules.tag_base, DEFAULT_TAG_BASE).split('/')
  const inside = (a: readonly string[], b: readonly string[]) => a.every((part, index) => b[index] === part)
  if (inside(category, tag) || inside(tag, category))
    return 'the category and tag bases must differ, and neither be inside the other'
  for (const base of [category, tag]) {
    if (base[0] === 'author' || base[0] === 'page')
      return 'a base cannot start with author or page (the site uses them)'
  }
  const first = rules.structure.split('/').find((part) => part !== '') ?? ''
  if (!first.includes('%') && (first === category[0] || first === tag[0])) {
    return 'the structure cannot start with a base'
  }
  return undefined
}

function invalid(field: string, message: string): AppError {
  return new AppError(400, 'invalid_setting', `${field}: ${message}`)
}

export function createSettingsService(options: {
  readonly db: Database
  readonly clock: () => Date
  readonly audit: Auditor
  readonly mail: SafeMail
  readonly limiter: Pick<RateLimiter, 'begin'>
  readonly publicOrigin: string
  readonly media: Pick<MediaService, 'contentRefs'>
  readonly onInvalidSetting?: (key: string) => void
}): SettingsService {
  const { db, clock, audit, mail } = options
  const read = <S extends Parameters<typeof readSettings>[1]>(picked: S) =>
    readSettings(db, picked, options.onInvalidSetting)

  function requireManage(auth: SessionAuth): void {
    if (!auth.capabilities.has('manage_options')) throw new ForbiddenError()
  }

  async function save(auth: SessionAuth, group: string, values: Record<string, unknown>, ctx: RequestContext) {
    const changed = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))
    if (Object.keys(changed).length === 0) return
    await inTransaction(db, async (tx) => {
      await writeSettings(tx, changed)
      await audit(tx, ctx, {
        actor: { id: auth.account.id, username: auth.account.username },
        action: 'settings.updated',
        objectType: 'settings',
        objectId: group,
        newValue: { keys: Object.keys(changed).sort() },
      })
    })
  }

  /** A page that may be chosen for the front page, the posts page or the privacy page: a page, not in the trash. */
  async function checkPage(field: string, id: string | null | undefined, published: boolean): Promise<void> {
    if (id === null || id === undefined) return
    const row = await findContent(db, id)
    if (row?.type !== 'page' || row.status === 'trash' || (published && row.status !== 'publish')) {
      throw invalid(field, published ? 'not a published page' : 'not a page')
    }
  }

  const service: SettingsService = {
    async general(auth) {
      requireManage(auth)
      return {
        settings: await read(GeneralSettings),
        siteUrl: options.publicOrigin,
        pendingAdminEmail: (await pendingAdminEmail(db, clock())) ?? null,
        locales: SITE_LOCALES.map((locale) => ({ ...locale })),
      }
    },

    async updateGeneral(auth, request, ctx) {
      requireManage(auth)
      const { new_admin_email: newAdminEmail, ...values } = request
      if (values.default_role !== undefined && (await findRoleBySlug(db, values.default_role)) === undefined) {
        throw invalid('default_role', 'no such role')
      }
      if (values.locale !== undefined && !SITE_LOCALES.some((locale) => locale.code === values.locale)) {
        throw invalid('locale', 'not a language the site has')
      }
      if (values.timezone_string !== undefined && !knownTimeZone(values.timezone_string)) {
        throw invalid('timezone_string', 'not a time zone')
      }
      if (newAdminEmail !== undefined) {
        const current = (await read(ADMIN_EMAIL)).admin_email
        if (current !== null && current.toLowerCase() === newAdminEmail.toLowerCase()) {
          throw new AppError(400, 'same_email', 'That is already the administrator address')
        }
        // Each request mails an address: a few per account in a window, as the flows that mail (security §5).
        const ticket = await options.limiter.begin('password_lost', {
          ip: ctx.ip,
          login: `admin-email:${auth.account.id}`,
        })
        assertNotDelayed(ticket.status, clock())
      }
      const changed = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))
      const token = newAdminEmail === undefined ? undefined : generateToken()
      // One transaction: the settings, the link and their audit entries are all written, or none of them.
      await inTransaction(db, async (tx) => {
        const now = clock()
        await lockAdminEmail(tx)
        if (Object.keys(changed).length > 0) {
          await writeSettings(tx, changed)
          await audit(tx, ctx, {
            actor: { id: auth.account.id, username: auth.account.username },
            action: 'settings.updated',
            objectType: 'settings',
            objectId: 'general',
            newValue: { keys: Object.keys(changed).sort() },
          })
        }
        if (newAdminEmail !== undefined && token !== undefined) {
          await invalidateAdminEmailTokens(tx, now)
          await insertAccountToken(tx, {
            accountId: auth.account.id,
            purpose: 'admin_email_change',
            tokenHash: hashToken(token),
            newEmail: newAdminEmail,
            expiresAt: new Date(now.getTime() + ONE_TIME_LINK_HOURS * HOUR_MS),
            now,
          })
          await audit(tx, ctx, {
            actor: { id: auth.account.id, username: auth.account.username },
            action: 'admin_email.requested',
            objectType: 'site',
            reason: 'pending confirmation',
          })
        }
      })
      if (newAdminEmail !== undefined && token !== undefined) {
        // To the NEW address, after the commit: opening the link proves it receives mail (WordPress' new_admin_email).
        await mail({
          template: 'admin_email_change',
          to: newAdminEmail,
          data: { username: auth.account.username, token },
        })
      }
      return service.general(auth)
    },

    async confirmAdminEmail(auth, token, ctx) {
      requireManage(auth)
      // Counted like any guess at a token (as the account's e-mail change).
      const ticket = await options.limiter.begin('password_lost', { ip: ctx.ip })
      assertNotDelayed(ticket.status, clock())
      const changed = await inTransaction(db, async (tx) => {
        const now = clock()
        await lockAdminEmail(tx)
        const { admin_email: oldEmail } = await readSettings(tx, ADMIN_EMAIL)
        const found = await findTokenForUpdate(tx, hashToken(token))
        if (
          found?.purpose !== 'admin_email_change' ||
          found.newEmail === null ||
          found.usedAt !== null ||
          found.expiresAt.getTime() <= now.getTime() ||
          !(await markTokenUsed(tx, found.id, now))
        ) {
          throw new InvalidTokenError()
        }
        await writeSettings(tx, { admin_email: found.newEmail })
        await invalidateAdminEmailTokens(tx, now)
        await audit(tx, ctx, {
          actor: { id: auth.account.id, username: auth.account.username },
          action: 'admin_email.confirmed',
          objectType: 'settings',
          objectId: 'general',
          newValue: { keys: ['admin_email'] },
        })
        return { oldEmail, newEmail: found.newEmail }
      })
      // To the OLD address, after the commit (WordPress' wp_site_admin_email_change_notification), unless it is the same.
      if (changed.oldEmail !== null && changed.oldEmail.toLowerCase() !== changed.newEmail.toLowerCase()) {
        await mail({ template: 'admin_email_changed', to: changed.oldEmail, data: { newEmail: changed.newEmail } })
      }
      return changed.newEmail
    },

    async writing(auth) {
      requireManage(auth)
      return { settings: await read(WritingSettings) }
    },

    async updateWriting(auth, request, ctx) {
      requireManage(auth)
      if (request.default_category !== undefined && request.default_category !== null) {
        const taxonomy = await findTaxonomy(db, 'category')
        if (taxonomy === undefined || (await findTerm(db, taxonomy.id, request.default_category)) === undefined) {
          throw invalid('default_category', 'no such category')
        }
      }
      if (request.default_category === null) throw invalid('default_category', 'a category is needed')
      await save(auth, 'writing', request, ctx)
      return service.writing(auth)
    },

    async reading(auth) {
      requireManage(auth)
      const settings = await read(ReadingSettings)
      const imageIds = [settings.seo_default_image, settings.seo_publisher_logo].filter(
        (id): id is string => id !== null,
      )
      const [media, people] = await Promise.all([
        imageIds.length === 0
          ? []
          : options.media.contentRefs({ id: auth.account.id, capabilities: auth.capabilities }, imageIds),
        publishingPeople(db),
      ])
      return {
        settings,
        media,
        people: people.map((person) => ({ id: person.id, displayName: person.displayName })),
      }
    },

    async updateReading(auth, request, ctx) {
      requireManage(auth)
      const stored = await read(ReadingSettings)
      const next = {
        show_on_front: request.show_on_front ?? stored.show_on_front,
        page_on_front: request.page_on_front === undefined ? stored.page_on_front : request.page_on_front,
        page_for_posts: request.page_for_posts === undefined ? stored.page_for_posts : request.page_for_posts,
      }
      await checkPage('page_on_front', request.page_on_front, true)
      await checkPage('page_for_posts', request.page_for_posts, true)
      // «Deling og søkemotorer»: images from the media library, and a person who has something published.
      for (const key of ['seo_default_image', 'seo_publisher_logo'] as const) {
        const imageId = request[key]
        if (imageId === undefined || imageId === null) continue
        // An image every visitor may see (a private one would drop out of the site's head), and for sharing one that social
        // sites show: JPEG, PNG, WebP or GIF (seo standard, «OG-bilder»).
        const [ref] = await options.media.contentRefs({ id: '', capabilities: new Set<string>() }, [imageId])
        const shareable = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
        const fits =
          key === 'seo_default_image' ? shareable.includes(ref?.mime ?? '') : ref?.mime.startsWith('image/') === true
        if (!fits) throw invalid(key, 'a public image from the media library (JPEG, PNG, WebP or GIF for sharing)')
      }
      if (
        request.seo_publisher_person !== undefined &&
        request.seo_publisher_person !== null &&
        !(await publishingPeople(db)).some((person) => person.id === request.seo_publisher_person)
      ) {
        throw invalid('seo_publisher_person', 'an active account with something published')
      }
      if (next.show_on_front === 'page' && next.page_on_front === null) {
        throw invalid('page_on_front', 'a static front page needs a page')
      }
      if (next.page_on_front !== null && next.page_on_front.toLowerCase() === next.page_for_posts?.toLowerCase()) {
        throw invalid('page_for_posts', 'the front page cannot also be the posts page')
      }
      await save(auth, 'reading', request, ctx)
      return service.reading(auth)
    },

    async privacy(auth) {
      requireManage(auth)
      return { settings: await read(PrivacySettings) }
    },

    async updatePrivacy(auth, request, ctx) {
      requireManage(auth)
      // A draft page may be chosen (WordPress' installer makes one); the site links it once it is published.
      await checkPage('wp_page_for_privacy_policy', request.wp_page_for_privacy_policy, false)
      await save(auth, 'privacy', request, ctx)
      return service.privacy(auth)
    },

    async permalinks(auth) {
      requireManage(auth)
      return { settings: await read(PermalinkSettings) }
    },

    async updatePermalinks(auth, request, ctx) {
      requireManage(auth)
      await inTransaction(db, async (tx) => {
        // One change of the rules at a time: each reads the history the one before it wrote.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('toascribe:permalinks', 0))`)
        const before = await readSettings(tx, PERMALINK_STATE, options.onInvalidSetting)
        const next = {
          structure: request.permalink_structure ?? before.permalink_structure,
          category_base: request.category_base ?? before.category_base,
          tag_base: request.tag_base ?? before.tag_base,
        }
        const problem = rulesProblem(next)
        if (problem !== undefined) throw invalid('permalinks', problem)
        const old = {
          structure: before.permalink_structure,
          category_base: before.category_base,
          tag_base: before.tag_base,
        }
        const same = (a: typeof old, b: typeof old) => JSON.stringify(a) === JSON.stringify(b)
        const changed = !same(next, old)
        // The rules the site had go first in the history: an address made under them is sent on to the new one with 301 (K-207).
        const history = changed
          ? [old, ...before.permalink_history.filter((entry) => !same(entry, old))]
              .filter((entry) => !same(entry, next))
              .slice(0, 10)
          : before.permalink_history
        const values = { ...request, ...(changed ? { permalink_history: history } : {}) }
        await writeSettings(tx, values)
        await audit(tx, ctx, {
          actor: { id: auth.account.id, username: auth.account.username },
          action: 'settings.updated',
          objectType: 'settings',
          objectId: 'permalinks',
          newValue: { keys: Object.keys(values).sort() },
        })
      })
      return service.permalinks(auth)
    },
  }
  return service
}
