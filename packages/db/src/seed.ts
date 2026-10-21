// The core seed: the five built-in roles and the default settings (PLAN «Roller og capabilities», «Innstillinger»).
// The migration runner calls it after every migration run, so a fresh `docker compose up` ends with both in place;
// `toa core install` (M0.4) and the tests call it too. No accounts, no content and no secrets are seeded.
import { CORE_SETTINGS, CORE_SETTING_KEYS, DEFAULT_ROLES } from '@toascribe/shared'
import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { role } from './schema/accounts.ts'
import { setting } from './schema/site.ts'

export interface SeedCoreResult {
  /** Built-in roles inserted by this run; 0 when all five were there. */
  readonly roles: number
  /** Core settings inserted by this run; 0 when every key was there. */
  readonly settings: number
}

/**
 * Inserts the built-in roles and the core settings that are missing, in one transaction, and returns how many it
 * inserted. Idempotent: it never updates a row, so a role whose capabilities an administrator edited and a setting
 * that was changed keep their values (ON CONFLICT DO NOTHING on `role.slug` and `setting.key`). A deleted built-in
 * role or setting comes back on the next run.
 *
 * It needs INSERT on `role` and `setting` only, so it runs as the owner role (the migration step) or the app role.
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

    return { roles: roles.length, settings: settings.length }
  })
}
