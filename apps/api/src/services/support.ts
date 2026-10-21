// Small things the account flows share: what a request tells a service, the audit entry, a mail that must not fail the flow.
import type { JsonValue } from '@toascribe/shared'
import type { Logger } from 'pino'

import { UNKNOWN_IP } from '../lib/client-ip.ts'
import { TooManyRequestsError } from '../lib/errors.ts'
import type { MailPort, MailRequest } from '../ports/mail.ts'
import { insertAuditEntry } from '../repositories/audit.ts'
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
  readonly newValue?: JsonValue
  readonly reason?: string
  /** The account the entry is about, when it is not the actor. Default: the actor. */
  readonly accountId?: string | null
}

export type Auditor = (db: Executor, ctx: RequestContext, input: AuditInput) => Promise<void>

export function createAuditor(clock: () => Date): Auditor {
  return (db, ctx, input) =>
    insertAuditEntry(db, {
      actorType: input.actor === null ? 'system' : 'account',
      actor: input.actor?.username ?? 'anonymous',
      accountId: input.accountId === undefined ? (input.actor?.id ?? null) : input.accountId,
      action: input.action,
      objectType: input.objectType,
      ...(input.objectId === undefined ? {} : { objectId: input.objectId }),
      ...(input.newValue === undefined ? {} : { newValue: input.newValue }),
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      source: 'api',
      ...(ctx.requestId === undefined ? {} : { correlationId: ctx.requestId }),
      ip: shownIp(ctx.ip),
      at: clock(),
    })
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

/** Seconds until the later of the two lockouts ends. */
export function secondsUntilUnlocked(status: LimitStatus, now: Date): number {
  const ends = [status.ip.until, status.account.until].flatMap((until) => (until === null ? [] : [until.getTime()]))
  return (Math.max(0, ...ends) - now.getTime()) / 1000
}

/** 429 when the address or the account is locked for this flow. For flows the caller is already signed in to, so no secret to keep. */
export function assertNotLocked(status: LimitStatus, now: Date): void {
  if (status.ip.locked || status.account.locked) {
    throw new TooManyRequestsError(secondsUntilUnlocked(status, now))
  }
}

/**
 * 429 when the address is locked, whatever the account. For the flows that must not show whether an account exists: a locked
 * account is handled by the flow itself (it answers like any other), a locked address is told.
 */
export function assertAddressNotLocked(status: LimitStatus, now: Date): void {
  if (status.ip.locked) {
    throw new TooManyRequestsError(((status.ip.until?.getTime() ?? now.getTime()) - now.getTime()) / 1000)
  }
}
