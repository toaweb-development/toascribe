import type { Database } from '@toascribe/db'

/** What a repository runs its queries on: the database, or the transaction a service opened (typescript §10). */
export type Executor = Parameters<Parameters<Database['transaction']>[0]>[0] | Database

/** Runs `work` in a transaction. Repositories called with the `tx` it passes are part of it. */
export function inTransaction<T>(db: Database, work: (tx: Executor) => Promise<T>): Promise<T> {
  return db.transaction((tx) => work(tx))
}
