// `toa maintenance on|off|status` (M1.7, K-266, K-288): maintenance mode, the setting the site reads (packages/db maintenance.ts).
// While it is on, visitors get 503 with Retry-After and the maintenance page; an account with manage_options sees the site, and the
// api answers as usual, so an administrator can sign in and turn it off. Each change writes an audit entry with «CLI» as the actor.
import { readMaintenanceMode, schema, setMaintenanceMode } from '@toascribe/db'
import type { MaintenanceMode } from '@toascribe/shared'
import { z } from 'zod'

import { UsageError, isCliResult, parseFlags, usageResult, withDatabase } from '../kit.ts'
import type { CommandOptions } from '../options.ts'
import type { CliResult } from '../result.ts'
import { MAINTENANCE_USAGE } from '../usage.ts'

const { auditLog } = schema

const Message = z.string().trim().max(500)
const RetryAfter = z.coerce.number().int().min(30).max(86_400)
const Format = z.enum(['table', 'json'])

function describe(state: MaintenanceMode, format: 'table' | 'json'): string {
  if (format === 'json') return `${JSON.stringify(state)}\n`
  return state.enabled
    ? `Maintenance mode is on (since ${state.since ?? 'unknown'}; Retry-After ${String(state.retryAfter)} s).${state.message === '' ? '' : `\nMessage: ${state.message}`}\n`
    : 'Maintenance mode is off.\n'
}

/** `toa maintenance on [--message <text>] [--retry-after <seconds>]`, `off`, `status [--format table|json]`. */
export async function maintenance(args: readonly string[], options: CommandOptions = {}): Promise<CliResult> {
  const [action, ...rest] = args
  let message: string | undefined
  let retryAfter: number | undefined
  let format: 'table' | 'json' = 'table'
  try {
    if (action !== 'on' && action !== 'off' && action !== 'status') {
      throw new UsageError('Say on, off or status.')
    }
    const flags = parseFlags(
      rest,
      action === 'on' ? { message: 'string', 'retry-after': 'string', format: 'string' } : { format: 'string' },
    )
    if (flags['message'] !== undefined) {
      const parsed = Message.safeParse(flags['message'])
      if (!parsed.success) throw new UsageError('--message is at most 500 characters.')
      message = parsed.data
    }
    if (flags['retry-after'] !== undefined) {
      const parsed = RetryAfter.safeParse(flags['retry-after'])
      if (!parsed.success) throw new UsageError('--retry-after is a number of seconds from 30 to 86400.')
      retryAfter = parsed.data
    }
    if (flags['format'] !== undefined) {
      const parsed = Format.safeParse(flags['format'])
      if (!parsed.success) throw new UsageError('--format is table or json.')
      format = parsed.data
    }
  } catch (err) {
    if (err instanceof UsageError) return usageResult(err.message, MAINTENANCE_USAGE)
    throw err
  }

  const outcome = await withDatabase(options, `maintenance ${action}`, async (db) => {
    if (action === 'status') return readMaintenanceMode(db)
    const now = new Date()
    return db.transaction(async (tx) => {
      const state = await setMaintenanceMode(
        tx,
        {
          enabled: action === 'on',
          ...(message === undefined ? {} : { message }),
          ...(retryAfter === undefined ? {} : { retryAfter }),
        },
        now,
      )
      await tx.insert(auditLog).values({
        actorType: 'system',
        actor: 'cli',
        accountId: null,
        action: action === 'on' ? 'maintenance.enabled' : 'maintenance.disabled',
        objectType: 'settings',
        objectId: 'maintenance_mode',
        newValue: { enabled: state.enabled, retryAfter: state.retryAfter },
        source: 'cli',
        ip: null,
        createdAt: now,
      })
      return state
    })
  })
  if (isCliResult(outcome)) return outcome
  return { code: 0, stdout: describe(outcome, format), stderr: '' }
}
