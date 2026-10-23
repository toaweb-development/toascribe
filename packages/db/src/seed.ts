// The core seed: the five built-in roles, the default settings and the two built-in taxonomies (PLAN «Roller og
// capabilities», «Innstillinger»). The migration runner calls it after every migration run, so a fresh `docker compose
// up` ends with them in place; `toa dev seed` and the tests call it too. No accounts, no content and no secrets are
// seeded: the default content is seedDefaultContent(), which the install runs once.
import { CORE_SETTINGS, CORE_SETTING_KEYS, DEFAULT_ROLES, DEFAULT_TAXONOMIES } from '@toascribe/shared'
import { sql } from 'drizzle-orm'
import type { NodePgDatabase, NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import type { PgDatabase } from 'drizzle-orm/pg-core'

import { role } from './schema/accounts.ts'
import { setting } from './schema/site.ts'
import { taxonomy } from './schema/taxonomy.ts'

export interface SeedCoreResult {
  /** Built-in roles inserted by this run; 0 when all five were there. */
  readonly roles: number
  /** Core settings inserted by this run; 0 when every key was there. */
  readonly settings: number
  /** Built-in taxonomies (category, post_tag) inserted by this run; 0 when both were there. */
  readonly taxonomies: number
}

/**
 * Inserts the built-in roles, the core settings and the built-in taxonomies that are missing, in one transaction, and
 * returns how many it inserted. Idempotent: it never updates a row, so a role whose capabilities an administrator
 * edited, a setting that was changed and a renamed taxonomy keep their values (ON CONFLICT DO NOTHING on `role.slug`,
 * `setting.key` and `taxonomy.slug`). A deleted built-in role, setting or taxonomy comes back on the next run.
 *
 * It needs INSERT on `role`, `setting` and `taxonomy` only, so it runs as the owner role (the migration step) or the
 * app role.
 */
export async function seedCore<TSchema extends Record<string, unknown>>(
  db: NodePgDatabase<TSchema>,
): Promise<SeedCoreResult> {
  return db.transaction(async (tx) => {
    const roles = await tx
      .insert(role)
      .values(DEFAULT_ROLES.map((r) => ({ slug: r.slug, name: r.name, capabilities: [...r.capabilities] })))
      .onConflictDoNothing({ target: role.slug })
      .returning({ slug: role.slug })

    const settings = await tx
      .insert(setting)
      .values(
        CORE_SETTING_KEYS.map((key) => ({
          key,
          // Through JSON text, so a null default is stored as JSON null: Drizzle sends a null parameter as SQL NULL,
          // which the NOT NULL column refuses.
          value: sql`${JSON.stringify(CORE_SETTINGS[key])}::jsonb`,
        })),
      )
      .onConflictDoNothing({ target: setting.key })
      .returning({ key: setting.key })

    const taxonomies = await insertBuiltInTaxonomies(tx)

    return { roles: roles.length, settings: settings.length, taxonomies }
  })
}

/** Inserts the built-in taxonomies that are missing and returns how many it inserted. Never updates a row. */
export async function insertBuiltInTaxonomies<TSchema extends Record<string, unknown>>(
  db: PgDatabase<NodePgQueryResultHKT, TSchema>,
): Promise<number> {
  const inserted = await db
    .insert(taxonomy)
    .values(
      DEFAULT_TAXONOMIES.map((t) => ({
        slug: t.slug,
        name: t.name,
        isHierarchical: t.isHierarchical,
        contentTypes: [...t.contentTypes],
      })),
    )
    .onConflictDoNothing({ target: taxonomy.slug })
    .returning({ slug: taxonomy.slug })
  return inserted.length
}
