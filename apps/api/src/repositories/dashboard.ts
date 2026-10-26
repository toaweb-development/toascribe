// The comment counts of the dashboard's «I korte trekk» (typescript §8); the post and page counts come from the content service. Reads only.
import { schema } from '@toascribe/db'
import { count, eq } from 'drizzle-orm'

import type { Executor } from './executor.ts'

const { comment } = schema

/** Comments with the given moderation state (`approved`, `pending`), of every type. */
export async function countComments(db: Executor, status: 'approved' | 'pending'): Promise<number> {
  const rows = await db.select({ n: count() }).from(comment).where(eq(comment.status, status))
  return rows[0]?.n ?? 0
}
