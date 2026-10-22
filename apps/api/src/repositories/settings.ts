// Reads of the `setting` table (typescript §8). A key is validated against the schema it is read with and falls back to the
// default when the row is missing or holds something the schema refuses, so a bad value can never loosen a security limit.
import { schema } from '@toascribe/db'
import { CORE_SETTINGS } from '@toascribe/shared'
import { inArray } from 'drizzle-orm'
import type { z } from 'zod'

import type { Executor } from './executor.ts'

const { setting } = schema

const DEFAULTS: ReadonlyMap<string, unknown> = new Map(Object.entries(CORE_SETTINGS))

/**
 * The settings named by `picked` (a `CoreSettings.pick({...})`), each as stored when valid and as the default otherwise.
 * `onInvalid` hears about every stored value that was refused, so it can be logged.
 */
export async function readSettings<S extends z.ZodObject<Record<string, z.ZodType>>>(
  db: Executor,
  picked: S,
  onInvalid?: (key: string) => void,
): Promise<z.infer<S>> {
  const keys = Object.keys(picked.shape)
  const rows = await db
    .select({ key: setting.key, value: setting.value })
    .from(setting)
    .where(inArray(setting.key, keys))
  const stored = new Map(rows.map((row) => [row.key, row.value]))
  const merged: Record<string, unknown> = {}
  for (const key of keys) {
    const field = picked.shape[key]
    const parsed = stored.has(key) && field !== undefined ? field.safeParse(stored.get(key)) : undefined
    if (parsed?.success === true) {
      merged[key] = parsed.data
    } else {
      if (parsed !== undefined) {
        onInvalid?.(key)
      }
      merged[key] = DEFAULTS.get(key)
    }
  }
  return picked.parse(merged)
}
