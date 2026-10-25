// The counts of the dashboard's «I korte trekk» (typescript §8). Reads only.
import { schema } from '@toascribe/db'
import { count, eq, and } from 'drizzle-orm'

import type { Executor } from './executor.ts'

const { comment, content } = schema

/** Published items (`status = publish`) of one content type, in every language. Trash, drafts and scheduled items are not counted. */
export async function countPublished(db: Executor, type: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(content)
    .where(and(eq(content.type, type), eq(content.status, 'publish')))
  return rows[0]?.n ?? 0
}

/** Comments with the given moderation state (`approved`, `pending`), of every type. */
export async function countComments(db: Executor, status: 'approved' | 'pending'): Promise<number> {
  const rows = await db.select({ n: count() }).from(comment).where(eq(comment.status, status))
  return rows[0]?.n ?? 0
}
