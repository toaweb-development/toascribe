// Small things the account flows share: what a request tells a service, the audit entry, a mail that must not fail the flow.
import type { JsonValue } from '@toascribe/shared'
import type { Logger } from 'pino'

import { UNKNOWN_IP } from '../lib/client-ip.ts'
import { TooManyRequestsError } from '../lib/errors.ts'
import type { MailPort, MailRequest } from '../ports/mail.ts'
import { insertAuditEntry } from '../repositories/audit.ts'
import { recordInvalidation } from '../repositories/public.ts'
import type { Executor } from '../repositories/executor.ts'
import type { LimitStatus } from './rate-limit.ts'

/** What a route tells a service about the request. */
export interface RequestContext {
  /** The client address as `getClientIp` gives it (UNKNOWN_IP when it could not be read). */
  readonly ip: string
  readonly requestId: string | undefined
}

/** The rate limiter counts requests with no readable address in one bucket (UNKNOWN_IP); the audit log shows them as nothing. */
export function shownIp(ip: string): string | null {
  return ip === UNKNOWN_IP ? null : ip
}

export interface AuditInput {
  /** The person who acted; `null` for an anonymous caller (a lost-password request, a registration). */
  readonly actor: { readonly id: string; readonly username: string } | null
  readonly action: string
  readonly objectType: string
  readonly objectId?: string
  readonly oldValue?: JsonValue
  readonly newValue?: JsonValue
  readonly reason?: string
  /** The account the entry is about, when it is not the actor. Default: the actor. */
  readonly accountId?: string | null
}

export type Auditor = (db: Executor, ctx: RequestContext, input: AuditInput) => Promise<void>

/**
 * The site's cache tags a change clears (M1.4): a post or a page clears itself and the lists of its type, a category or a tag
 * itself and the post lists, a file itself, a menu or a global set itself, and settings everything (`*`: a setting can change any page). The other objects
 * (accounts, sessions, folders, notices) are not shown on the site. An author's name is cleared where it changes (me.ts).
 */
export function cacheTagsOf(input: Pick<AuditInput, 'objectType' | 'objectId'>): string[] {
  const id = input.objectId
  switch (input.objectType) {
    case 'post':
    case 'page':
      return id === undefined ? [`list:${input.objectType}`] : [`content:${id}`, `list:${input.objectType}`]
    case 'category':
    case 'post_tag':
      return id === undefined ? ['list:post'] : [`term:${id}`, 'list:post']
    case 'media':
      return id === undefined ? [] : [`media:${id}`]
    case 'menu':
      // A menu, or the locations (no id): the site's menus are cleared.
      return id === undefined ? ['menus'] : [`menu:${id}`, 'menus']
    case 'global_set':
      // `global_sets`: a set made or deleted changes the site's answer «no such set» too.
      return id === undefined ? ['global_sets'] : [`global_set:${id}`, 'global_sets']
    case 'settings':
      return ['*']
    default:
      return []
  }
}

/** Writes the audit entry, and in the same transaction the cache tags the change clears on the site. */
/**
 * The auditor of the api, or of `toa` (M1.7, K-263): from the CLI the actor is «cli» (a system actor) and the account whose rights
 * the command used (`--user`) is kept as the entry's account, with `source: 'cli'`.
 */
export function createAuditor(clock: () => Date, source: 'api' | 'cli' = 'api'): Auditor {
  return async (db, ctx, input) => {
    const at = clock()
    await insertAuditEntry(db, {
      actorType: input.actor === null || source === 'cli' ? 'system' : 'account',
      actor: source === 'cli' ? 'cli' : (input.actor?.username ?? 'anonymous'),
      accountId: input.accountId === undefined ? (input.actor?.id ?? null) : input.accountId,
      action: input.action,
      objectType: input.objectType,
      ...(input.objectId === undefined ? {} : { objectId: input.objectId }),
      ...(input.oldValue === undefined ? {} : { oldValue: input.oldValue }),
      ...(input.newValue === undefined ? {} : { newValue: input.newValue }),
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      source,
      ...(ctx.requestId === undefined ? {} : { correlationId: ctx.requestId }),
      ip: shownIp(ctx.ip),
      at,
    })
    await recordInvalidation(db, cacheTagsOf(input), at)
  }
}

/**
 * Queues a mail after the change it belongs to has been committed. A failure to queue is logged and swallowed: the flows
 * that must answer the same whether or not an account exists would otherwise show it by failing only when it does, and a
 * flow that has already changed something must not report an error for the notice. The log has the template and the error,
 * never the message (it holds an address and a token).
 */
export type SafeMail = (request: MailRequest) => Promise<void>

export function createSafeMail(mail: MailPort, logger: Logger): SafeMail {
  return async (request) => {
    try {
      await mail.sendMail(request)
    } catch (err) {
      logger.error(
        { template: request.template, errorName: err instanceof Error ? err.name : 'unknown' },
        'could not queue a mail',
      )
    }
  }
}

/** Seconds until the later of the two waits ends. */
export function secondsUntilAnswered(status: LimitStatus, now: Date): number {
  const ends = [status.ip.until, status.account.until].flatMap((until) => (until === null ? [] : [until.getTime()]))
  return (Math.max(0, ...ends) - now.getTime()) / 1000
}

/**
 * 429 with Retry-After when the address, or the account or login name, has to wait for this flow. The answer is the same
 * whether or not the account exists, because the wait of a login name that matches none is counted exactly like a real one
 * (K-004), so it gives nothing away. Nothing is locked: the wait ends by itself.
 */
export function assertNotDelayed(status: LimitStatus, now: Date): void {
  if (status.ip.delayed || status.account.delayed) {
    throw new TooManyRequestsError(secondsUntilAnswered(status, now))
  }
}
