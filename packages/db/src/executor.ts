// What the data-layer helpers take: a Drizzle client or a transaction over node-postgres, with any schema. The api's
// `Database` and the `tx` its `db.transaction()` passes both fit, and so does a bare `drizzle({ client })` in a test.
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import type { PgDatabase, PgTransaction } from 'drizzle-orm/pg-core'

export type DbExecutor<TSchema extends Record<string, unknown>> = PgDatabase<NodePgQueryResultHKT, TSchema>

/** A transaction only: for helpers whose lock or check is worthless outside one (pg_advisory_xact_lock). */
export type DbTransaction<TSchema extends Record<string, unknown>> = PgTransaction<
  NodePgQueryResultHKT,
  TSchema,
  ExtractTablesWithRelations<TSchema>
>
