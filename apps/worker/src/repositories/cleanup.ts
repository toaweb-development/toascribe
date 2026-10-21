// The statements of the daily clean-up (K-017's neighbours: PLAN «Personvern», M0.3). The only place in the worker that
// deletes or blanks rows. The app role has plain DML on these tables, nothing more (DATAMODEL), and on the audit log it may
// only call the SQL function that clears the IP addresses.
//
// Every statement works through a bounded batch (`id in (select id ... limit n)`), repeated until a batch comes back short, so
// a big backlog (login attempts under an attack) never holds a long lock. Each is safe to run twice: the second run finds
// nothing left to do.
import type { Database } from '@toascribe/db'
import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

const BATCH_SIZE = 5000
/** A guard against a loop that cannot end: 5000 x 2000 is 10 million rows in one run. */
const MAX_BATCHES = 2000

async function inBatches(db: Database, statement: (limit: number) => SQL): Promise<number> {
  let total = 0
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const result = await db.execute(statement(BATCH_SIZE))
    const changed = result.rowCount ?? 0
    total += changed
    if (changed < BATCH_SIZE) {
      break
    }
  }
  return total
}

/** Sessions that have ended. A half-signed-in session (waiting for the second factor) is just one with a short expiry. */
export function deleteExpiredSessions(db: Database, now: Date): Promise<number> {
  return inBatches(
    db,
    (limit) => sql`delete from session where id in (
      select id from session where expires_at < ${now} limit ${limit})`,
  )
}

/** One-time links that are used up or have expired. A used link is dead already (used_at), so nothing is lost by removing it. */
export function deleteSpentAccountTokens(db: Database, now: Date): Promise<number> {
  return inBatches(
    db,
    (limit) => sql`delete from account_token where id in (
      select id from account_token where expires_at < ${now} or used_at is not null limit ${limit})`,
  )
}

/** Blanks the IP address of sessions made before `cutoff`. */
export function clearSessionIps(db: Database, cutoff: Date): Promise<number> {
  return inBatches(
    db,
    (limit) => sql`update session set ip = null where id in (
      select id from session where ip is not null and created_at < ${cutoff} limit ${limit})`,
  )
}

/** Blanks the IP address of comments written before `cutoff`. */
export function clearCommentIps(db: Database, cutoff: Date): Promise<number> {
  return inBatches(
    db,
    (limit) => sql`update comment set ip = null where id in (
      select id from comment where ip is not null and created_at < ${cutoff} limit ${limit})`,
  )
}

/** Blanks the address an application password was last used from, when that was before `cutoff`. */
export function clearAppPasswordIps(db: Database, cutoff: Date): Promise<number> {
  return inBatches(
    db,
    (limit) => sql`update app_password set last_used_ip = null where id in (
      select id from app_password
      where last_used_ip is not null and coalesce(last_used_at, created_at) < ${cutoff} limit ${limit})`,
  )
}

/** Deletes login attempts older than `cutoff`. The limiter only looks at the last day or so; the rest is IP data kept for nothing. */
export function deleteOldLoginAttempts(db: Database, cutoff: Date): Promise<number> {
  return inBatches(
    db,
    (limit) => sql`delete from login_attempt where id in (
      select id from login_attempt where created_at < ${cutoff} limit ${limit})`,
  )
}

/** Deletes comments marked as spam since before `cutoff`. Their replies keep standing (parent_id is set to null by the foreign key). */
export function deleteOldSpamComments(db: Database, cutoff: Date): Promise<number> {
  return inBatches(
    db,
    (limit) => sql`delete from comment where id in (
      select id from comment where status = 'spam' and modified_at < ${cutoff} limit ${limit})`,
  )
}

/**
 * Blanks the IP addresses in the audit log that are older than `ip_retention_days`. The log is append-only for the app role, so
 * this is the one thing it may do to it: call the owner's function, which reads the setting itself (floor 7 days) and returns how
 * many rows it blanked.
 */
export async function clearOldAuditIps(db: Database): Promise<number> {
  const result = await db.execute<{ cleared: string | number }>(sql`select public.audit_log_clear_old_ips() as cleared`)
  const cleared = result.rows[0]?.cleared
  return typeof cleared === 'string' ? Number(cleared) : (cleared ?? 0)
}
