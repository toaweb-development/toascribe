// `toa option list|get|update` (M1.7, K-264), as WP-CLI's. The settings are a fixed set (CoreSettings), so `add` and `delete` are
// refused. A change goes through the settings screen the key belongs to («Generelt», «Skriving», «Lesing», «Personvern»,
// «Permalenker», «Media», «Oppdateringer»): the same request schema and the same checks as the api, as the account named by --user,
// audited with «cli». A key on no screen (the install's flags, maintenance mode, the status of backups and updates) is read-only
// here; maintenance mode has its own command. The encrypted SMTP password is never shown.
import {
  CORE_SETTING_KEYS,
  MediaSettings,
  PermalinkSettings,
  PrivacySettings,
  ReadingSettings,
  UpdateGeneralSettingsRequest,
  UpdateMediaSettingsRequest,
  UpdatePermalinkSettingsRequest,
  UpdatePrivacySettingsRequest,
  UpdateReadingSettingsRequest,
  UpdateUpdatesSettingsRequest,
  UpdateWritingSettingsRequest,
  WritingSettings,
} from '@toascribe/shared'
import { schema } from '@toascribe/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { UsageError, invalidInput, parseFlags, usageResult } from '../kit.ts'
import type { CommandOptions } from '../options.ts'
import type { CliResult } from '../result.ts'
import { Format, render, takeArgument, withServices, withoutControls } from '../services.ts'
import type { ServiceRun } from '../services.ts'
import { OPTION_USAGE } from '../usage.ts'
import { zodFields } from './content.ts'

type Group = 'general' | 'writing' | 'reading' | 'privacy' | 'permalinks' | 'media' | 'updates'

/** Where each settable key is changed. `admin_email` is not: a new address waits for its confirmation link («Generelt»). */
const GROUP_OF = new Map<string, Group>([
  ...Object.keys(UpdateGeneralSettingsRequest.shape).map((key) => [key, 'general'] as const),
  ...Object.keys(WritingSettings.shape).map((key) => [key, 'writing'] as const),
  ...Object.keys(ReadingSettings.shape).map((key) => [key, 'reading'] as const),
  ...Object.keys(PrivacySettings.shape).map((key) => [key, 'privacy'] as const),
  ...Object.keys(PermalinkSettings.shape).map((key) => [key, 'permalinks'] as const),
  ...Object.keys(MediaSettings.shape).map((key) => [key, 'media'] as const),
  ['update_check', 'updates'],
])

/** Every setting as the screens read them, the hidden ones as `[encrypted]` or null. */
async function readAll(run: ServiceRun): Promise<Record<string, unknown>> {
  const { services, auth } = run
  const values: Record<string, unknown> = {}
  const groups = await Promise.all([
    services.settings.general(auth),
    services.settings.writing(auth),
    services.settings.reading(auth),
    services.settings.privacy(auth),
    services.settings.permalinks(auth),
    services.media.settings(auth),
  ])
  for (const group of groups) Object.assign(values, group.settings)
  const updates = await services.siteTools.updates(auth)
  values['update_check'] = updates.enabled
  // On no screen, and never shown: only whether it is set.
  const [smtp] = await run.db
    .select({ value: schema.setting.value })
    .from(schema.setting)
    .where(eq(schema.setting.key, 'smtp_password'))
  values['smtp_password'] = typeof smtp?.value === 'string' ? '[encrypted]' : null
  return values
}

/** The value on the command line: JSON when it reads as JSON (true, 42, ["a"], "text"), else the text itself. */
function valueOf(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

async function save(run: ServiceRun, group: Group, key: string, value: unknown): Promise<void> {
  const { services, auth, ctx } = run
  const body = { [key]: value }
  switch (group) {
    case 'general':
      await services.settings.updateGeneral(auth, UpdateGeneralSettingsRequest.parse(body), ctx)
      return
    case 'writing':
      await services.settings.updateWriting(auth, UpdateWritingSettingsRequest.parse(body), ctx)
      return
    case 'reading':
      await services.settings.updateReading(auth, UpdateReadingSettingsRequest.parse(body), ctx)
      return
    case 'privacy':
      await services.settings.updatePrivacy(auth, UpdatePrivacySettingsRequest.parse(body), ctx)
      return
    case 'permalinks':
      await services.settings.updatePermalinks(auth, UpdatePermalinkSettingsRequest.parse(body), ctx)
      return
    case 'media':
      await services.media.updateSettings(auth, UpdateMediaSettingsRequest.parse(body), ctx)
      return
    case 'updates':
      await services.siteTools.updateUpdates(auth, UpdateUpdatesSettingsRequest.parse({ enabled: value }), ctx)
      return
  }
}

export async function option(args: readonly string[], options: CommandOptions = {}): Promise<CliResult> {
  const [action, ...rest] = args
  try {
    switch (action) {
      case 'list': {
        const flags = parseFlags(rest, { user: 'string', format: 'string', search: 'string' })
        const format = Format.parse(flags['format'] ?? 'table')
        const search = typeof flags['search'] === 'string' ? flags['search'] : ''
        return await withServices(options, 'option list', str(flags['user']), async (run) => {
          const values = await readAll(run)
          const rows = Object.entries(values)
            .filter(([key]) => key.includes(search))
            .map(([key, value]) => ({ key, value }))
          return { code: 0, stdout: render(rows, ['key', 'value'], format), stderr: '' }
        })
      }
      case 'get': {
        const [key, flagArgs] = takeArgument(rest)
        const flags = parseFlags(flagArgs, { user: 'string', format: 'string' })
        const format = Format.parse(flags['format'] ?? 'table')
        if (key === undefined) throw new UsageError('Give the key after get.')
        return await withServices(options, 'option get', str(flags['user']), async (run) => {
          const values = await readAll(run)
          if (!Object.hasOwn(values, key)) {
            return (CORE_SETTING_KEYS as readonly string[]).includes(key)
              ? invalidInput(`${key} is not on a settings screen; it is read-only here.`)
              : invalidInput(`There is no setting ${key}.`)
          }
          const value = values[key]
          return {
            code: 0,
            stdout:
              format === 'json'
                ? `${JSON.stringify(value)}\n`
                : `${withoutControls(typeof value === 'string' ? value : JSON.stringify(value))}\n`,
            stderr: '',
          }
        })
      }
      case 'update': {
        const [key, afterKey] = takeArgument(rest)
        const [raw, flagArgs] = takeArgument(afterKey)
        const flags = parseFlags(flagArgs, { user: 'string' })
        if (key === undefined || raw === undefined) throw new UsageError('Give the key and the value after update.')
        const group = GROUP_OF.get(key)
        if (group === undefined) {
          if (key === 'admin_email')
            return invalidInput('admin_email changes after its confirmation link: use «Innstillinger → Generelt».')
          if (key === 'maintenance_mode') return invalidInput('Use toa maintenance on|off.')
          return (CORE_SETTING_KEYS as readonly string[]).includes(key)
            ? invalidInput(`${key} is not on a settings screen; it cannot be set here.`)
            : invalidInput(`There is no setting ${key}.`)
        }
        const value = valueOf(raw)
        return await withServices(options, 'option update', str(flags['user']), async (run) => {
          await save(run, group, key, value)
          return { code: 0, stdout: `Updated ${key}.\n`, stderr: '' }
        })
      }
      case 'add':
      case 'delete':
        return invalidInput(
          'The settings are a fixed set: none is added or deleted. Change a value with toa option update.',
        )
      default:
        throw new UsageError('Say list, get or update.')
    }
  } catch (err) {
    if (err instanceof UsageError) return usageResult(err.message, OPTION_USAGE)
    if (err instanceof z.ZodError) return invalidInput(zodFields(err))
    throw err
  }
}

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
