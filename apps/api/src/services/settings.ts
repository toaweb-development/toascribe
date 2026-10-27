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
  GeneralSettings,
  ONE_TIME_LINK_HOURS,
  PrivacySettings,
  ReadingSettings,
  SITE_LOCALES,
  WritingSettings,
} from '@toascribe/shared'
import type {
  GeneralSettingsResponse,
  PrivacySettingsResponse,
  ReadingSettingsResponse,
  UpdateGeneralSettingsRequest,
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
import { inTransaction } from '../repositories/executor.ts'
import type { Executor } from '../repositories/executor.ts'
import { readSettings, writeSettings } from '../repositories/settings.ts'
import { findTaxonomy, findTerm } from '../repositories/terms.ts'
import { findRoleBySlug } from '../repositories/users.ts'
import type { RateLimiter } from './rate-limit.ts'
import { assertNotDelayed } from './support.ts'
import type { Auditor, RequestContext, SafeMail } from './support.ts'

const HOUR_MS = 60 * 60 * 1000
const ADMIN_EMAIL = CoreSettings.pick({ admin_email: true })

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
      return inTransaction(db, async (tx) => {
        const now = clock()
        await lockAdminEmail(tx)
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
        return found.newEmail
      })
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
      return { settings: await read(ReadingSettings) }
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
  }
  return service
}
