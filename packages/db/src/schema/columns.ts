// Column and constraint helpers shared by the domain files. Names follow POSTGRESQL_STANDARD «Navnekonvensjoner»:
// idx_<table>_<columns>, uq_<table>_<columns>, fk_<table>_<column> and ck_<table>_<rule>; see docs/DATAMODEL.md.
import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { customType, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

/** Primary key: a time-ordered UUID from PostgreSQL 18's built-in uuidv7() (no extension). */
export const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`)

/** Every timestamp is timestamptz, stored in UTC. */
export const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

export const createdAt = () => timestamptz('created_at').notNull().defaultNow()

/**
 * Set on insert by the default and on every update by the repository layer, which writes `modified_at = now()` in the
 * same UPDATE. There is no trigger, and Drizzle's `$onUpdate` is not used either: it only runs for updates made through
 * the Drizzle query builder, so a raw `sql` update or a bulk job would skip it silently. One explicit rule is easier to
 * review than two half-rules.
 */
export const modifiedAt = () => timestamptz('modified_at').notNull().defaultNow()

/** Both timestamps, for tables whose rows change after insert. Append-only tables have created_at only. */
export const timestamps = () => ({ createdAt: createdAt(), modifiedAt: modifiedAt() })

/** Full-text search vector; Drizzle 0.45 has no built-in tsvector column. */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
})

/** A full transaction id (PostgreSQL 13+), as its decimal text: what `pg_current_xact_id()` gives. */
export const xid8 = customType<{ data: string; driverData: string }>({
  dataType: () => 'xid8',
})

/** Internet address (IPv4 or IPv6), as text in TypeScript. */
export const inet = customType<{ data: string; driverData: string }>({
  dataType: () => 'inet',
})

const LITERAL = /^[a-z0-9_]+$/

function literal(value: string | number): string {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new Error(`value set member ${String(value)} is not an integer`)
    }
    return String(value)
  }
  if (!LITERAL.test(value)) {
    throw new Error(`value set member "${value}" is not a lower-case machine name`)
  }
  return `'${value}'`
}

/**
 * `col IN (...)` for a CHECK constraint, from a value list in @toascribe/shared. The values are written into the DDL
 * as literals (a CHECK cannot take parameters), so each must be a plain machine name or an integer.
 */
export function oneOf(column: AnyPgColumn, values: readonly (string | number)[]): SQL {
  if (values.length === 0) {
    throw new Error('a value set needs at least one value')
  }
  return sql`${column} in (${sql.raw(values.map(literal).join(', '))})`
}

/** URLs and paths that are unique keys stay well under the btree entry limit (about 2700 bytes). */
export const MAX_KEY_URL_LENGTH = 2048
