// «Oppdateringer» (M1.7, K-290) and «Verktøy → Nettstedshelse → Info» (M1.7, K-203). The update page reads what the worker and
// `toa check-update` stored (the api never asks a registry itself) and turns the check on or off; the admin cannot update
// containers, so it shows the command for the host. Nettstedshelse gathers facts about the install in groups; the copy for support
// is the same facts as plain text through redactForCopy, and no field holds a secret, a token, an address or a path to begin with.
import { arch, freemem, release, totalmem, type as osType } from 'node:os'

import { readBackupConfig } from '@toascribe/backup'
import { getMigrationStatus } from '@toascribe/db'
import type { Database } from '@toascribe/db'
import {
  CoreSettings,
  RELEASE_REPOSITORY,
  SITE_HEALTH_STATUSES,
  SITE_HEALTH_TESTS,
  siteHealthText,
} from '@toascribe/shared'
import type {
  SiteHealthField,
  SiteHealthGroup,
  SiteHealthInfoResponse,
  SiteHealthStatusResponse,
  SiteHealthTest,
  UpdateUpdatesSettingsRequest,
  UpdatesResponse,
} from '@toascribe/shared'
import { isNewer } from '@toascribe/updates'

import type { SessionAuth } from '../lib/auth-context.ts'
import { ForbiddenError } from '../lib/errors.ts'
import { inTransaction } from '../repositories/executor.ts'
import { readSettings, writeSettings } from '../repositories/settings.ts'
import { databaseFacts, mediaFacts, queueFacts } from '../repositories/site-health.ts'
import type { ActiveThemeSource } from './active-theme.ts'
import type { PreviewLimit } from './preview-limit.ts'
import type { Auditor, RequestContext } from './support.ts'

/** The worker counts as running when its scheduler ticked within this long (pg-boss ticks about every 30 s). */
const WORKER_STALE_MS = 3 * 60 * 1000

/** A backup older than this, or none at all, is «bør forbedres» on the dashboard: the daily backup should have made a newer one. */
const BACKUP_STALE_MS = 2 * 24 * 60 * 60 * 1000

const UPDATE_SETTINGS = CoreSettings.pick({ update_check: true, update_status: true })
const HEALTH_SETTINGS = CoreSettings.pick({
  locale: true,
  timezone_string: true,
  gmt_offset: true,
  permalink_structure: true,
  blog_public: true,
  upload_max_size_mb: true,
  backup_status: true,
  update_check: true,
  update_status: true,
})
const STATUS_SETTINGS = CoreSettings.pick({
  blog_public: true,
  backup_status: true,
  update_status: true,
  smtp_verified_at: true,
})

export interface SiteToolsService {
  updates(auth: SessionAuth): Promise<UpdatesResponse>
  updateUpdates(auth: SessionAuth, request: UpdateUpdatesSettingsRequest, ctx: RequestContext): Promise<UpdatesResponse>
  healthInfo(auth: SessionAuth): Promise<SiteHealthInfoResponse>
  healthStatus(auth: SessionAuth): Promise<SiteHealthStatusResponse>
}

const field = (key: string, kind: SiteHealthField['kind'], value: SiteHealthField['value']): SiteHealthField => ({
  key,
  kind,
  value,
})

/** A failure while gathering one group shows as that group with one field, `error`, and the rest of the page still works. */
async function group(key: SiteHealthGroup['key'], fields: () => Promise<SiteHealthField[]>): Promise<SiteHealthGroup> {
  try {
    return { key, fields: await fields() }
  } catch {
    return { key, fields: [field('error', 'word', 'unavailable')] }
  }
}

export function createSiteToolsService(options: {
  readonly db: Database
  readonly clock: () => Date
  readonly audit: Auditor
  readonly version: string
  /** NODE_ENV. */
  readonly environment: string
  /** TOASCRIBE_DEBUG=1. */
  readonly debug: boolean
  /** TOASCRIBE_UPDATE_CHECK is not `off`. */
  readonly serverAllowsUpdateCheck: boolean
  /** toascribe.toml, for whether the daily backup is on. */
  readonly configFile: string
  /** UPLOAD_MAX_SIZE_MB, the cap above the setting. */
  readonly uploadCapMb: number
  readonly previewLimit: Pick<PreviewLimit, 'probe'>
  readonly activeTheme: ActiveThemeSource
  readonly onInvalidSetting?: (key: string) => void
}): SiteToolsService {
  const { db, clock, audit } = options

  function requireCapability(auth: SessionAuth, capability: 'update_core' | 'manage_options'): void {
    if (!auth.capabilities.has(capability)) throw new ForbiddenError()
  }

  async function updates(): Promise<UpdatesResponse> {
    const settings = await readSettings(db, UPDATE_SETTINGS, options.onInvalidSetting)
    const status = settings.update_status
    const available = status !== null && isNewer(status.latest, options.version)
    return {
      current: options.version,
      enabled: settings.update_check,
      disabledByServer: !options.serverAllowsUpdateCheck,
      status: status === null ? null : { checkedAt: status.checkedAt, ok: status.ok, latest: status.latest, available },
      changelogUrl:
        available && status.latest !== null
          ? `https://github.com/${RELEASE_REPOSITORY}/blob/v${status.latest}/CHANGELOG.md`
          : null,
    }
  }

  return {
    async updates(auth) {
      requireCapability(auth, 'update_core')
      return updates()
    },

    async updateUpdates(auth, request, ctx) {
      requireCapability(auth, 'update_core')
      await inTransaction(db, async (tx) => {
        await writeSettings(tx, { update_check: request.enabled })
        // `system`, not `settings`: the site shows nothing of it, so its cache stays.
        await audit(tx, ctx, {
          actor: { id: auth.account.id, username: auth.account.username },
          action: 'settings.updated',
          objectType: 'system',
          objectId: 'update_check',
          newValue: { enabled: request.enabled },
        })
      })
      return updates()
    },

    async healthInfo(auth) {
      requireCapability(auth, 'manage_options')
      const settings = await readSettings(db, HEALTH_SETTINGS, options.onInvalidSetting)
      const now = clock()
      const groups = await Promise.all([
        group('toascribe', async () => {
          const migrations = await getMigrationStatus(db)
          return [
            field('version', 'text', options.version),
            field(
              'migration',
              'text',
              migrations.upToDate
                ? migrations.latest
                : `${String(migrations.applied)} / ${String(migrations.expected)}`,
            ),
            field('environment', 'word', options.environment),
            field('debug', 'boolean', options.debug),
          ]
        }),
        group('server', () =>
          Promise.resolve([
            field('node', 'text', process.version),
            field('os', 'text', `${osType()} ${release()} ${arch()}`),
            field('memoryTotal', 'bytes', totalmem()),
            field('memoryFree', 'bytes', freemem()),
            field('apiMemory', 'bytes', process.memoryUsage().rss),
          ]),
        ),
        group('database', async () => {
          const facts = await databaseFacts(db)
          return [field('version', 'text', facts.version), field('size', 'bytes', facts.sizeBytes)]
        }),
        group('cache', async () => {
          const probe = await options.previewLimit.probe()
          return [field('backend', 'word', probe.backend), field('answers', 'boolean', probe.answers)]
        }),
        group('worker', async () => {
          const facts = await queueFacts(db)
          const running = facts.lastTick !== null && now.getTime() - facts.lastTick.getTime() < WORKER_STALE_MS
          return [
            field('status', 'word', running ? 'running' : 'notRunning'),
            field('lastSeen', 'datetime', facts.lastTick?.toISOString() ?? null),
            field('queues', 'number', facts.queues),
            field('queued', 'number', facts.queued),
            field('active', 'number', facts.active),
            field('failed', 'number', facts.failed),
          ]
        }),
        group('site', async () => {
          const theme = await options.activeTheme.current().catch(() => undefined)
          return [
            field(
              'theme',
              'text',
              theme === undefined ? null : theme === null ? '-' : `${theme.name} ${theme.version}`,
            ),
            field('language', 'text', settings.locale),
            field(
              'timezone',
              'text',
              settings.timezone_string === '' ? `UTC${offset(settings.gmt_offset)}` : settings.timezone_string,
            ),
            field('permalinks', 'text', settings.permalink_structure === '' ? '-' : settings.permalink_structure),
            field('public', 'boolean', settings.blog_public),
          ]
        }),
        group('media', async () => {
          const facts = await mediaFacts(db)
          return [
            field('files', 'number', facts.files),
            field('size', 'bytes', facts.bytes),
            field('uploadMax', 'bytes', Math.min(settings.upload_max_size_mb, options.uploadCapMb) * 1024 * 1024),
          ]
        }),
        group('backup', () => {
          const last = settings.backup_status
          let scheduled: boolean | null
          try {
            scheduled = readBackupConfig(options.configFile).schedule
          } catch {
            scheduled = null
          }
          return Promise.resolve([
            field('last', 'datetime', last?.at ?? null),
            field('ok', 'boolean', last?.ok ?? null),
            field('file', 'text', last?.file ?? null),
            field('size', 'bytes', last?.size ?? null),
            field('scheduled', 'boolean', scheduled),
          ])
        }),
        group('updates', () => {
          const status = settings.update_status
          return Promise.resolve([
            field('enabled', 'boolean', settings.update_check && options.serverAllowsUpdateCheck),
            field('lastCheck', 'datetime', status?.checkedAt ?? null),
            field('latest', 'text', status?.latest ?? null),
            field('available', 'boolean', status === null ? null : isNewer(status.latest, options.version)),
          ])
        }),
      ])
      return { groups, text: siteHealthText(groups) }
    },

    async healthStatus(auth) {
      requireCapability(auth, 'manage_options')
      const settings = await readSettings(db, STATUS_SETTINGS, options.onInvalidSetting)
      const now = clock().getTime()
      // A check that cannot be made counts as critical: the dashboard should not call a site healthy when it could not look.
      const check = async (
        key: SiteHealthTest['key'],
        status: () => Promise<SiteHealthTest['status']> | SiteHealthTest['status'],
      ): Promise<SiteHealthTest> => {
        try {
          return { key, status: await status() }
        } catch {
          return { key, status: 'critical' }
        }
      }
      const tests = await Promise.all([
        check('worker', async () => {
          const { lastTick } = await queueFacts(db)
          return lastTick !== null && now - lastTick.getTime() < WORKER_STALE_MS ? 'good' : 'critical'
        }),
        check('migrations', async () => ((await getMigrationStatus(db)).upToDate ? 'good' : 'critical')),
        check('backup', () => {
          const last = settings.backup_status
          if (last?.ok === false) return 'critical'
          // An unreadable time counts as old: NaN compares false, which would read as fresh.
          const age = last === null ? Number.NaN : now - new Date(last.at).getTime()
          if (!(age <= BACKUP_STALE_MS)) return 'recommended'
          return 'good'
        }),
        check('updates', () => {
          const status = settings.update_status
          return status !== null && isNewer(status.latest, options.version) ? 'recommended' : 'good'
        }),
        check('email', () => (settings.smtp_verified_at === null ? 'recommended' : 'good')),
        check('cache', async () => ((await options.previewLimit.probe()).answers === false ? 'recommended' : 'good')),
        check('debug', () => (options.debug ? 'recommended' : 'good')),
        check('searchEngines', () => (settings.blog_public ? 'good' : 'recommended')),
      ])
      const rank = (test: SiteHealthTest) =>
        (SITE_HEALTH_STATUSES.length - SITE_HEALTH_STATUSES.indexOf(test.status)) * 100 +
        SITE_HEALTH_TESTS.indexOf(test.key)
      return { tests: tests.sort((a, b) => rank(a) - rank(b)) }
    },
  }
}

function offset(hours: number): string {
  if (hours === 0) return ''
  const sign = hours < 0 ? '-' : '+'
  const whole = Math.trunc(Math.abs(hours))
  const minutes = Math.round((Math.abs(hours) - whole) * 60)
  return `${sign}${String(whole)}${minutes === 0 ? '' : `:${String(minutes).padStart(2, '0')}`}`
}
