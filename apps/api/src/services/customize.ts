// «Utseende → Tilpass» (M1.5, K-150, K-151): the identity of the site (settings), and the active theme's colours, fonts and «Ekstra
// CSS», stored per theme in `extension_state` (kind `theme`), so another theme keeps its own. The admin names the theme: the site's
// build knows which theme is active, and the admin reads it from there (/_toascribe/theme).
//
// «Ekstra CSS» needs `edit_css`, a meta capability as in WordPress' map_meta_cap(): `edit_theme_options` and `unfiltered_html` (the
// rule WordPress applies on a multisite, applied always: a stylesheet can make a page look like anything, as raw HTML can). Among the
// built-in roles only the administrator holds both. The CSS is checked so that it cannot leave its `<style>` (customCssProblem).
//
// The title, the tagline and the icon are «Generelt»'s settings and need what it needs, `manage_options` (WordPress' Customizer gives
// them the same capability); the logo is the theme's, `edit_theme_options`. A row in `extension_state` made here carries no version
// of the theme: the registry's version is the installer's to write (K-174), never the client's.

import type { Database } from '@toascribe/db'
import { schema } from '@toascribe/db'
import { CoreSettings, EMPTY_CUSTOMIZATION, ThemeCustomization } from '@toascribe/shared'
import type { CustomizeResponse, PublicCustomizeResponse, UpdateCustomizeRequest } from '@toascribe/shared'
import { and, eq } from 'drizzle-orm'

import type { SessionAuth } from '../lib/auth-context.ts'
import { AppError, ForbiddenError } from '../lib/errors.ts'
import type { Executor } from '../repositories/executor.ts'
import { inTransaction } from '../repositories/executor.ts'
import { readSettings, writeSettings } from '../repositories/settings.ts'
import type { MediaService } from './media.ts'
import type { Auditor, RequestContext } from './support.ts'

const { extensionState } = schema
const IDENTITY = CoreSettings.pick({ blogname: true, blogdescription: true, site_logo: true, site_icon: true })
const VISITOR = { id: '', capabilities: new Set<string>() } as const
const GENERAL_KEYS = ['blogname', 'blogdescription', 'site_icon'] as const
/** What `version` holds for a theme whose choices were stored before the theme registry knew it (phase 3 writes the real one). */
const NO_VERSION = ''

/** `edit_css`: may change «Ekstra CSS» (see the head of this file). */
export function canEditCss(capabilities: ReadonlySet<string>): boolean {
  return capabilities.has('edit_theme_options') && capabilities.has('unfiltered_html')
}

export interface CustomizeService {
  get(auth: SessionAuth, theme: string): Promise<CustomizeResponse>
  update(auth: SessionAuth, request: UpdateCustomizeRequest, ctx: RequestContext): Promise<CustomizeResponse>
  publicFor(theme: string): Promise<PublicCustomizeResponse>
}

async function storedFor(db: Executor, theme: string, lock = false): Promise<ThemeCustomization> {
  const query = db
    .select({ settings: extensionState.settings })
    .from(extensionState)
    .where(and(eq(extensionState.kind, 'theme'), eq(extensionState.slug, theme)))
    .limit(1)
  const rows = lock ? await query.for('update') : await query
  const parsed = ThemeCustomization.safeParse(rows[0]?.settings ?? EMPTY_CUSTOMIZATION)
  return parsed.success ? parsed.data : EMPTY_CUSTOMIZATION
}

export function createCustomizeService(options: {
  readonly db: Database
  readonly clock: () => Date
  readonly audit: Auditor
  readonly media: Pick<MediaService, 'contentRefs'>
  readonly onInvalidSetting?: (key: string) => void
}): CustomizeService {
  const { db, clock, audit, media } = options

  async function imagesOf(actor: { id: string; capabilities: ReadonlySet<string> }, ids: readonly (string | null)[]) {
    const wanted = ids.filter((id): id is string => id !== null)
    return wanted.length === 0 ? [] : media.contentRefs(actor, wanted)
  }

  const service: CustomizeService = {
    async get(auth, theme) {
      if (!auth.capabilities.has('edit_theme_options')) throw new ForbiddenError()
      const [identity, customization] = await Promise.all([
        readSettings(db, IDENTITY, options.onInvalidSetting),
        storedFor(db, theme),
      ])
      return {
        theme,
        identity,
        customization,
        media: await imagesOf({ id: auth.account.id, capabilities: auth.capabilities }, [
          identity.site_logo,
          identity.site_icon,
        ]),
        mayEditCss: canEditCss(auth.capabilities),
        mayEditIdentity: auth.capabilities.has('manage_options'),
      }
    },

    async update(auth, request, ctx) {
      if (!auth.capabilities.has('edit_theme_options')) throw new ForbiddenError()
      await inTransaction(db, async (tx) => {
        // The row first, then locked: two saves at once merge one after the other, and neither brings back what the other replaced.
        const now = clock()
        await tx
          .insert(extensionState)
          .values({
            kind: 'theme',
            slug: request.theme,
            version: NO_VERSION,
            settings: EMPTY_CUSTOMIZATION,
            createdAt: now,
            modifiedAt: now,
          })
          .onConflictDoNothing({ target: [extensionState.kind, extensionState.slug] })
        const before = await storedFor(tx, request.theme, true)
        if (request.identity !== undefined && !auth.capabilities.has('manage_options')) {
          const general = await readSettings(tx, IDENTITY, options.onInvalidSetting)
          if (
            GENERAL_KEYS.some((key) => request.identity?.[key] !== undefined && request.identity[key] !== general[key])
          ) {
            throw new ForbiddenError()
          }
        }
        if (
          request.customCss !== undefined &&
          request.customCss !== before.customCss &&
          !canEditCss(auth.capabilities)
        ) {
          throw new ForbiddenError()
        }
        const images = await imagesOf({ id: auth.account.id, capabilities: auth.capabilities }, [
          request.identity?.site_logo ?? null,
          request.identity?.site_icon ?? null,
        ])
        for (const id of [request.identity?.site_logo, request.identity?.site_icon]) {
          if (id != null && !images.some((ref) => ref.id === id && ref.mime.startsWith('image/'))) {
            throw new AppError(400, 'invalid_media', 'The logo and the icon are images in the media library')
          }
        }
        const next: ThemeCustomization = {
          colors: request.colors ?? before.colors,
          fonts: request.fonts ?? before.fonts,
          customCss: request.customCss ?? before.customCss,
        }
        await tx
          .update(extensionState)
          .set({ settings: next, modifiedAt: now })
          .where(and(eq(extensionState.kind, 'theme'), eq(extensionState.slug, request.theme)))
        if (request.identity !== undefined) {
          const identity = Object.fromEntries(
            Object.entries(request.identity).filter(
              ([key, value]) =>
                value !== undefined &&
                // Without manage_options, «Generelt»'s keys were checked to be unchanged above: never written back.
                (auth.capabilities.has('manage_options') || !(GENERAL_KEYS as readonly string[]).includes(key)),
            ),
          )
          await writeSettings(tx, identity)
        }
        await audit(tx, ctx, {
          actor: { id: auth.account.id, username: auth.account.username },
          action: 'settings.updated',
          objectType: 'settings',
          objectId: 'customize',
          newValue: {
            theme: request.theme,
            keys: [
              ...Object.keys(request.identity ?? {}),
              ...(['colors', 'fonts', 'customCss'] as const).filter((key) => request[key] !== undefined),
            ].sort(),
          },
        })
      })
      return service.get(auth, request.theme)
    },

    async publicFor(theme) {
      const [identity, customization] = await Promise.all([
        readSettings(db, IDENTITY, options.onInvalidSetting),
        storedFor(db, theme),
      ])
      const images = await imagesOf(VISITOR, [identity.site_logo, identity.site_icon])
      return {
        customization,
        logo: images.find((ref) => ref.id === identity.site_logo) ?? null,
        icon: images.find((ref) => ref.id === identity.site_icon) ?? null,
        cacheTags: ['settings', ...images.map((ref) => `media:${ref.id}`)],
      }
    },
  }
  return service
}
