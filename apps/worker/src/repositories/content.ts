// The content jobs' statements (M1.1, K-062 to K-064). The scheduler publishes and unpublishes what is due; the purge deletes
// what has been in the trash for 30 days. Each statement takes its rows with FOR UPDATE SKIP LOCKED and checks the status again on
// the row it locked, so two workers that run at the same moment split the rows between them, and a row is changed once: the
// second run finds nothing left. The audit entries are written in the same transaction as the change.
import { deleteContentPermanently, schema } from '@toascribe/db'
import type { Database } from '@toascribe/db'
import { sql } from 'drizzle-orm'

const { auditLog } = schema

/** Rows per statement. A safety bound, not a setting: the loop runs again until a batch comes back short. */
const BATCH_SIZE = 500
const MAX_BATCHES = 200

export interface ChangedItem {
  readonly id: string
  readonly type: string
}

type Executor = Parameters<Parameters<Database['transaction']>[0]>[0]

async function audit(
  tx: Executor,
  job: string,
  action: string,
  items: readonly ChangedItem[],
  at: Date,
): Promise<void> {
  if (items.length === 0) {
    return
  }
  await tx.insert(auditLog).values(
    items.map((item) => ({
      actorType: 'system',
      actor: job,
      accountId: null,
      action,
      objectType: item.type,
      objectId: item.id,
      source: 'job',
      ip: null,
      createdAt: at,
    })),
  )
}

async function inBatches(db: Database, batch: (tx: Executor) => Promise<number>): Promise<number> {
  let total = 0
  for (let round = 0; round < MAX_BATCHES; round += 1) {
    const changed = await db.transaction(batch)
    total += changed
    if (changed < BATCH_SIZE) {
      break
    }
  }
  return total
}

/** Scheduled items whose publish time has come become `publish` (K-063). Returns how many. */
export function publishDue(db: Database, now: Date, job: string): Promise<number> {
  return inBatches(db, async (tx) => {
    const result = await tx.execute<{ id: string; type: string }>(sql`
      with due as (
        select id from content
        where status = 'future' and published_at <= ${now}
        order by published_at
        limit ${BATCH_SIZE}
        for update skip locked
      )
      update content set status = 'publish', modified_at = ${now}
      from due where content.id = due.id and content.status = 'future'
      returning content.id, content.type`)
    await audit(tx, job, 'content.published', result.rows, now)
    return result.rows.length
  })
}

/**
 * Published items whose unpublish time has passed go back to `draft` (K-064), and the time is cleared so that publishing the
 * item again does not take it down at once. Returns how many.
 */
export function unpublishDue(db: Database, now: Date, job: string): Promise<number> {
  return inBatches(db, async (tx) => {
    const result = await tx.execute<{ id: string; type: string }>(sql`
      with due as (
        select id from content
        where status = 'publish' and unpublish_at <= ${now}
        order by unpublish_at
        limit ${BATCH_SIZE}
        for update skip locked
      )
      update content set status = 'draft', unpublish_at = null, modified_at = ${now}
      from due where content.id = due.id and content.status = 'publish'
      returning content.id, content.type`)
    await audit(tx, job, 'content.unpublished', result.rows, now)
    return result.rows.length
  })
}

/**
 * Deletes items that went into the trash before `cutoff` (K-062). A trashed item cannot be changed, so `modified_at` is the time it
 * was trashed. Each item is deleted in a transaction of its own, after its row is locked and checked again (it may have been
 * restored meanwhile); its child pages move up to its parent first (deleteContentPermanently). Returns how many.
 */
export async function purgeTrash(db: Database, cutoff: Date, now: Date, job: string): Promise<number> {
  let total = 0
  for (let round = 0; round < MAX_BATCHES; round += 1) {
    const candidates = await db.execute<{ id: string }>(sql`
      select id from content where status = 'trash' and modified_at < ${cutoff}
      order by modified_at limit ${BATCH_SIZE}`)
    let deleted = 0
    for (const { id } of candidates.rows) {
      const removed = await db.transaction(async (tx) => {
        const locked = await tx.execute<{ id: string }>(sql`
          select id from content where id = ${id} and status = 'trash' and modified_at < ${cutoff}
          for update skip locked`)
        if (locked.rows.length === 0) {
          return undefined
        }
        const item = await deleteContentPermanently(tx, id)
        if (item !== undefined) {
          await audit(tx, job, 'content.deleted', [item], now)
        }
        return item
      })
      if (removed !== undefined) {
        deleted += 1
      }
    }
    total += deleted
    if (candidates.rows.length < BATCH_SIZE) {
      break
    }
  }
  return total
}
