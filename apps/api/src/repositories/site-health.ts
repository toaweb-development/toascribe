// What Nettstedshelse reads from the database (M1.7, K-203): the server's version and the database's size, the job queue's state
// (pg-boss: the worker's last scheduling tick, the queued, active and failed jobs) and the media library's size. Read as the app role.
import { schema } from '@toascribe/db'
import { count, sql, sum } from 'drizzle-orm'
import { z } from 'zod'

import type { Executor } from './executor.ts'

export interface DatabaseFacts {
  readonly version: string
  readonly sizeBytes: number
}

export async function databaseFacts(db: Executor): Promise<DatabaseFacts> {
  const result = await db.execute(
    sql`select current_setting('server_version') as version, pg_database_size(current_database())::bigint::text as size`,
  )
  const row = z.object({ version: z.string(), size: z.string() }).parse(result.rows[0])
  return { version: row.version, sizeBytes: Number(row.size) }
}

export interface QueueFacts {
  /** When the worker's scheduler last ran (pg-boss `version.cron_on`); null when it never has. */
  readonly lastTick: Date | null
  readonly queues: number
  readonly queued: number
  readonly active: number
  readonly failed: number
}

/** pg-boss's own tables, read directly: the counts its monitor keeps per queue, and the failed jobs it still holds. */
export async function queueFacts(db: Executor): Promise<QueueFacts> {
  const result = await db.execute(sql`
    select
      (select max(cron_on) from pgboss.version)::text as tick,
      (select count(*) from pgboss.queue)::int as queues,
      (select coalesce(sum(queued_count), 0) from pgboss.queue)::int as queued,
      (select coalesce(sum(active_count), 0) from pgboss.queue)::int as active,
      (select count(*) from pgboss.job where state = 'failed')::int as failed`)
  const row = z
    .object({
      tick: z.string().nullable(),
      queues: z.number(),
      queued: z.number(),
      active: z.number(),
      failed: z.number(),
    })
    .parse(result.rows[0])
  return {
    lastTick: row.tick === null ? null : new Date(row.tick),
    queues: row.queues,
    queued: row.queued,
    active: row.active,
    failed: row.failed,
  }
}

export async function mediaFacts(db: Executor): Promise<{ readonly files: number; readonly bytes: number }> {
  const [row] = await db.select({ files: count(), bytes: sum(schema.media.size) }).from(schema.media)
  return { files: row?.files ?? 0, bytes: Number(row?.bytes ?? 0) }
}
