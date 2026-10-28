// What adding and deleting an account needs from the database (M1.8, K-020, K-021): the content an account is an author of, with
// how many authors each item has; moving that authorship to another account; and the account's removal.
import { schema } from '@toascribe/db'
import { and, count, eq, inArray, sql } from 'drizzle-orm'

import type { Executor } from './executor.ts'

const { account, contentAuthor, media } = schema

export interface AuthoredItem {
  readonly contentId: string
  /** Every author of the item, this account included. */
  readonly authors: number
}

/** The content the account is an author of (any status), locked for the change, with how many authors each has. */
export async function authoredContent(db: Executor, accountId: string): Promise<AuthoredItem[]> {
  const rows = await db.execute(sql`
    select ca.content_id::text as "contentId",
           (select count(*) from content_author other where other.content_id = ca.content_id)::int as authors
    from content_author ca
    where ca.account_id = ${accountId}
    order by ca.content_id
    for update of ca`)
  return rows.rows as unknown as AuthoredItem[]
}

export async function countAuthoredContent(db: Executor, accountId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(contentAuthor).where(eq(contentAuthor.accountId, accountId))
  return row?.n ?? 0
}

/** Moves the account's authorship of `contentIds` to `to`; where `to` is already an author, the account's row just goes. */
export async function reassignAuthorship(
  db: Executor,
  from: string,
  to: string,
  contentIds: readonly string[],
): Promise<void> {
  if (contentIds.length === 0) return
  await db
    .delete(contentAuthor)
    .where(
      and(
        eq(contentAuthor.accountId, from),
        inArray(contentAuthor.contentId, [...contentIds]),
        sql`exists (select 1 from content_author mine where mine.content_id = ${contentAuthor.contentId} and mine.account_id = ${to})`,
      ),
    )
  await db
    .update(contentAuthor)
    .set({ accountId: to })
    .where(and(eq(contentAuthor.accountId, from), inArray(contentAuthor.contentId, [...contentIds])))
}

/** Takes the account off content it shares with other authors. */
export async function dropAuthorship(db: Executor, accountId: string, contentIds: readonly string[]): Promise<void> {
  if (contentIds.length === 0) return
  await db
    .delete(contentAuthor)
    .where(and(eq(contentAuthor.accountId, accountId), inArray(contentAuthor.contentId, [...contentIds])))
}

/** The files the account uploaded go to `to` (WordPress reassigns attachments with the posts). */
export async function reassignUploads(db: Executor, from: string, to: string): Promise<void> {
  await db.update(media).set({ uploadedBy: to }).where(eq(media.uploadedBy, from))
}

/** Locks the account row for the rest of the transaction (a concurrent new author link waits for it). */
export async function lockAccount(db: Executor, accountId: string): Promise<void> {
  await db.execute(sql`select 1 from account where id = ${accountId} for update`)
}

/** Deletes the account; its sessions, tokens, application passwords and factors go with it (cascade). */
export async function deleteAccount(db: Executor, accountId: string): Promise<boolean> {
  const rows = await db.delete(account).where(eq(account.id, accountId)).returning({ id: account.id })
  return rows.length === 1
}
