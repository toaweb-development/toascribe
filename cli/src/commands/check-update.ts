// `toa check-update` and `toa core check-update` (M1.7, K-290, K-261): the update check at once, as the worker runs it each day. The
// result goes into `update_status` («Oppdateringer» and Nettstedshelse show it). Off (TOASCRIBE_UPDATE_CHECK=off, or the setting),
// nothing is asked and the command says so (exit 1). Nothing about the site is sent: a GET of the public image tags.
import { schema } from '@toascribe/db'
import { defaultUpdateSource, isNewer, runUpdateCheck } from '@toascribe/updates'
import { z } from 'zod'

import { loadUpdateCheckConfig } from '../config.ts'
import { UsageError, isCliResult, parseFlags, refusal, usageResult, withConfiguredDatabase } from '../kit.ts'
import type { CommandOptions } from '../options.ts'
import type { CliResult } from '../result.ts'
import { CHECK_UPDATE_USAGE } from '../usage.ts'

const Format = z.enum(['table', 'json'])

export async function checkUpdate(
  args: readonly string[],
  version: string,
  options: CommandOptions = {},
): Promise<CliResult> {
  let format: 'table' | 'json' = 'table'
  try {
    const flags = parseFlags(args, { format: 'string' })
    if (flags['format'] !== undefined) {
      const parsed = Format.safeParse(flags['format'])
      if (!parsed.success) throw new UsageError('--format is table or json.')
      format = parsed.data
    }
  } catch (err) {
    if (err instanceof UsageError) return usageResult(err.message, CHECK_UPDATE_USAGE)
    throw err
  }

  const outcome = await withConfiguredDatabase(
    options,
    'check-update',
    loadUpdateCheckConfig,
    async (db, _logger, config) => {
      const result = await runUpdateCheck(db, {
        source: options.updateSource ?? defaultUpdateSource(),
        current: version,
        serverAllows: config.TOASCRIBE_UPDATE_CHECK !== 'off',
        now: new Date(),
      })
      if (result.checked) {
        await db.insert(schema.auditLog).values({
          actorType: 'system',
          actor: 'cli',
          accountId: null,
          action: 'updates.checked',
          objectType: 'system',
          objectId: 'update_status',
          newValue: { ok: result.status.ok, latest: result.status.latest },
          source: 'cli',
          ip: null,
        })
      }
      return result
    },
  )
  if (isCliResult(outcome)) return outcome
  if (!outcome.checked) {
    return refusal(
      outcome.by === 'server'
        ? 'The update check is off on this server (TOASCRIBE_UPDATE_CHECK=off). Nothing was asked.'
        : 'The update check is off (the update_check setting, «Oppdateringer» in the admin). Nothing was asked.',
    )
  }
  const { status } = outcome
  const available = isNewer(status.latest, version)
  if (format === 'json') {
    return { code: status.ok ? 0 : 1, stdout: `${JSON.stringify({ ...status, available })}\n`, stderr: '' }
  }
  if (!status.ok) return refusal(`The update check failed: ${status.error ?? 'unknown'}.`)
  const line = available
    ? `toascribe ${status.latest ?? ''} is out; this is ${version}. On the host: docker compose pull && docker compose up -d`
    : `toascribe ${version} is the newest release${status.latest === null ? ' (none found)' : ''}.`
  return { code: 0, stdout: `${line}\n`, stderr: '' }
}
