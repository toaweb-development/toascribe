// The editor prototype's draft (M0.6, PROTOTYPE; the content API of M1.1 replaces it). One draft post per account, found by its
// slug and, in the same query, by the account being its author (security §2: the owner is part of every lookup). Only the
// blocks change after it is created.
import { schema } from '@toascribe/db'
import type { Blocks } from '@toascribe/shared'
import { and, eq, isNull, sql } from 'drizzle-orm'

import type { Executor } from './executor.ts'

const { content, contentAuthor } = schema

/** The slug of an account's prototype draft. The account id keeps it unique and stable when the username changes. */
export function prototypeSlug(accountId: string): string {
  return `editor-prototype-${accountId}`
}

export interface PrototypeDraftRow {
  readonly id: string
  readonly blocks: Blocks
  readonly modifiedAt: Date
}

export async function findPrototypeDraft(db: Executor, accountId: string): Promise<PrototypeDraftRow | undefined> {
  const rows = await db
    .select({ id: content.id, blocks: content.blocks, modifiedAt: content.modifiedAt })
    .from(content)
    .innerJoin(contentAuthor, eq(contentAuthor.contentId, content.id))
    .where(
      and(
        eq(content.type, 'post'),
        eq(content.slug, prototypeSlug(accountId)),
        isNull(content.parentId),
        eq(contentAuthor.accountId, accountId),
      ),
    )
    .limit(1)
  return rows[0]
}

/**
 * Stores the blocks of the account's draft, creating the draft (status `draft`, comments closed) the first time. Run it in a
 * transaction: it takes a lock per account, so two first saves at once do not both insert.
 */
export async function savePrototypeDraft(
  db: Executor,
  input: { readonly accountId: string; readonly locale: string; readonly blocks: Blocks; readonly at: Date },
): Promise<PrototypeDraftRow> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`toascribe:editor-prototype:${input.accountId}`}, 0))`,
  )
  const existing = await findPrototypeDraft(db, input.accountId)
  if (existing !== undefined) {
    const [row] = await db
      .update(content)
      .set({ blocks: input.blocks, modifiedAt: input.at })
      .where(eq(content.id, existing.id))
      .returning({ id: content.id, blocks: content.blocks, modifiedAt: content.modifiedAt })
    if (row === undefined) {
      throw new Error('update of the prototype draft returned no row')
    }
    return row
  }
  const [row] = await db
    .insert(content)
    .values({
      type: 'post',
      locale: input.locale,
      slug: prototypeSlug(input.accountId),
      title: 'Editor prototype',
      status: 'draft',
      commentStatus: 'closed',
      blocks: input.blocks,
      createdAt: input.at,
      modifiedAt: input.at,
    })
    .returning({ id: content.id, blocks: content.blocks, modifiedAt: content.modifiedAt })
  if (row === undefined) {
    throw new Error('insert of the prototype draft returned no row')
  }
  await db.insert(contentAuthor).values({ contentId: row.id, accountId: input.accountId, sort: 0 })
  return row
}
