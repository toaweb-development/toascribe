// The queries of the install service (typescript §8). It reads and writes the few tables the install touches, as the app
// role (DML only). Everything takes the executor it should run on, so the install transaction can pass its `tx`.
import { schema, writeSetting } from '@toascribe/db'
import type { Database } from '@toascribe/db'
import { CORE_SETTINGS } from '@toascribe/shared'
import type { AuditActorType, AuditSource, CoreSettingKey, JsonValue } from '@toascribe/shared'
import { eq, inArray, sql } from 'drizzle-orm'
import type { z } from 'zod'

const { account, accountRole, adminNotice, auditLog, role, setting } = schema

/** The database, or the transaction the install opened. */
export type Executor = Parameters<Parameters<Database['transaction']>[0]>[0] | Database

/**
 * The settings named by `picked` (a `CoreSettings.pick({...})`), each as stored when valid and as the default otherwise (a
 * value that the setting's schema refuses cannot be used; the default is the safe reading, as in the api's own reader).
 */
export async function readSettings<S extends z.ZodObject<Record<string, z.ZodType>>>(
  db: Executor,
  picked: S,
): Promise<z.infer<S>> {
  const keys = Object.keys(picked.shape)
  const rows = await db
    .select({ key: setting.key, value: setting.value })
    .from(setting)
    .where(inArray(setting.key, keys))
  const stored = new Map(rows.map((row) => [row.key, row.value]))
  const defaults: ReadonlyMap<string, unknown> = new Map(Object.entries(CORE_SETTINGS))
  const merged: Record<string, unknown> = {}
  for (const key of keys) {
    const field = picked.shape[key]
    const parsed = stored.has(key) && field !== undefined ? field.safeParse(stored.get(key)) : undefined
    merged[key] = parsed?.success === true ? parsed.data : defaults.get(key)
  }
  return picked.parse(merged)
}

/** Writes core settings, each checked against its own schema (a ZodError otherwise). */
export async function writeSettings(
  db: Executor,
  entries: readonly (readonly [CoreSettingKey, JsonValue])[],
): Promise<void> {
  for (const [key, value] of entries) {
    await writeSetting(db, key, value)
  }
}

/** True when a notice with this key is stored (showing or dismissed). */
export async function hasAdminNotice(db: Executor, key: string): Promise<boolean> {
  const rows = await db.select({ id: adminNotice.id }).from(adminNotice).where(eq(adminNotice.key, key)).limit(1)
  return rows.length > 0
}

/** The account with this id, or undefined. */
export async function findAccountById(
  db: Executor,
  id: string,
): Promise<{ readonly id: string; readonly username: string } | undefined> {
  const rows = await db
    .select({ id: account.id, username: account.username })
    .from(account)
    .where(eq(account.id, id))
    .limit(1)
  return rows[0]
}

export async function findAdministratorRoleId(db: Executor): Promise<string | undefined> {
  const rows = await db.select({ id: role.id }).from(role).where(eq(role.slug, 'administrator')).limit(1)
  return rows[0]?.id
}

/** The URL name of the author archive, as the api makes it from a username (`nicenameFor` in apps/api). */
export function nicenameFor(username: string): string {
  const slug = username
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug === '' ? 'user' : slug
}

/** The first of `base`, `base-2`, `base-3`, ... that no account has as its nicename. */
export async function freeNicename(db: Executor, base: string): Promise<string> {
  for (let n = 1; n <= 50; n += 1) {
    const candidate = n === 1 ? base : `${base}-${String(n)}`
    const rows = await db
      .select({ id: account.id })
      .from(account)
      .where(sql`lower(${account.nicename}) = lower(${candidate})`)
      .limit(1)
    if (rows.length === 0) {
      return candidate
    }
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`
}

export interface NewAdministrator {
  readonly username: string
  readonly email: string
  readonly nicename: string
  readonly passwordHash: string
  readonly roleId: string
  readonly now: Date
}

/** Inserts an active account with the administrator role. A name or address that is taken makes PostgreSQL refuse (23505). */
export async function insertAdministrator(db: Executor, input: NewAdministrator): Promise<string> {
  const rows = await db
    .insert(account)
    .values({
      username: input.username,
      email: input.email,
      displayName: input.username,
      nicename: input.nicename,
      passwordHash: input.passwordHash,
      status: 'active',
      createdAt: input.now,
      modifiedAt: input.now,
    })
    .returning({ id: account.id })
  const row = rows[0]
  if (row === undefined) {
    throw new Error('the account insert returned no row')
  }
  await db.insert(accountRole).values({ accountId: row.id, roleId: input.roleId, createdAt: input.now })
  return row.id
}

export interface InstallAudit {
  /** Default `account`. */
  readonly actorType?: AuditActorType
  readonly actor: string
  readonly accountId: string | null
  readonly action: string
  readonly objectType: string
  readonly newValue?: JsonValue
  readonly source: AuditSource
  readonly correlationId?: string
  readonly ip: string | null
  readonly at: Date
}

/** The audit entry of the install (the app role may insert and read `audit_log`, not change it). */
export async function insertAudit(db: Executor, entry: InstallAudit): Promise<void> {
  await db.insert(auditLog).values({
    actorType: entry.actorType ?? 'account',
    actor: entry.actor,
    accountId: entry.accountId,
    action: entry.action,
    objectType: entry.objectType,
    objectId: null,
    newValue: entry.newValue ?? null,
    reason: null,
    source: entry.source,
    correlationId: entry.correlationId ?? null,
    ip: entry.ip,
    createdAt: entry.at,
  })
}
