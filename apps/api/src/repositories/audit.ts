// The only place that writes `audit_log` (typescript §8). The app role may insert and read, not change or delete (migration 0001).
import { schema } from '@toascribe/db'
import type { AuditActorType, AuditSource, JsonValue } from '@toascribe/shared'

import type { Executor } from './executor.ts'

const { auditLog } = schema

export interface AuditEntry {
  readonly actorType: AuditActorType
  /** The username at the time for an account, otherwise the name of the job or tool. Never empty. */
  readonly actor: string
  readonly accountId: string | null
  /** `login.succeeded`, `session.revoked`, ... */
  readonly action: string
  readonly objectType?: string
  readonly objectId?: string
  readonly newValue?: JsonValue
  readonly reason?: string
  readonly source: AuditSource
  /** The request id. */
  readonly correlationId?: string
  readonly ip: string | null
  readonly at: Date
}

export async function insertAuditEntry(db: Executor, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actorType: entry.actorType,
    actor: entry.actor,
    accountId: entry.accountId,
    action: entry.action,
    objectType: entry.objectType ?? null,
    objectId: entry.objectId ?? null,
    newValue: entry.newValue ?? null,
    reason: entry.reason ?? null,
    source: entry.source,
    correlationId: entry.correlationId ?? null,
    ip: entry.ip,
    createdAt: entry.at,
  })
}
