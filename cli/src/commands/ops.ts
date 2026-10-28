// `toa cache flush`, `toa jobs list|retry|cancel` and `toa secrets list|rotate` (M1.7, K-265, K-270, K-271). Each change writes an
// audit entry with «cli» as the actor. Nothing prints a secret: `secrets list` names them and says where they are, never a value,
// and a job's data (a mail job holds a sealed token) is never shown.
import { randomBytes } from 'node:crypto'

import { PGBOSS_APP_OPTIONS, schema } from '@toascribe/db'
import type { Database } from '@toascribe/db'
import { SMTP_PASSWORD_AAD } from '@toascribe/shared'
import type { JsonValue, KeyRing } from '@toascribe/shared'
import { eq, isNotNull, sql } from 'drizzle-orm'
import { PgBoss } from 'pg-boss'
import { z } from 'zod'

import type { EnvSource } from '../config.ts'
import { currentKeyVersion, highestKeyVersion, keyRingOf, loadKeyedDatabaseConfig, namesSet } from '../config.ts'
import { createTerminalPrompter } from '../prompt.ts'
import { secretsExport, secretsImport } from './secrets-file.ts'
import {
  UsageError,
  invalidInput,
  isCliResult,
  parseFlags,
  refusal,
  usageResult,
  withConfiguredDatabase,
  withDatabase,
} from '../kit.ts'
import type { CommandOptions } from '../options.ts'
import type { CliResult } from '../result.ts'
import { Format, render } from '../services.ts'
import { CACHE_USAGE, JOBS_USAGE, SECRETS_USAGE } from '../usage.ts'

const { auditLog, cacheInvalidation, mfaCredential, setting } = schema

async function audit(
  db: Database,
  action: string,
  objectType: string,
  objectId: string | null,
  newValue: Readonly<Record<string, JsonValue>>,
): Promise<void> {
  await db.insert(auditLog).values({
    actorType: 'system',
    actor: 'cli',
    accountId: null,
    action,
    objectType,
    ...(objectId === null ? {} : { objectId }),
    newValue,
    source: 'cli',
    ip: null,
  })
}

// ── cache ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A tag the site's cache knows: `*` (everything), a list (`list:post`), or an object (`content:<id>`, `menus`). */
const CacheTag = z.string().regex(/^(\*|[a-z_]{1,40}(:[a-z0-9_-]{1,64})?)$/)

/** `toa cache flush [--tag <tag>]`: the site drops its cached answers (all of them, or those under the tag) at its next request. */
export async function cache(args: readonly string[], options: CommandOptions = {}): Promise<CliResult> {
  const [action, ...rest] = args
  let tag = '*'
  try {
    if (action !== 'flush') throw new UsageError('Say flush.')
    const flags = parseFlags(rest, { tag: 'string' })
    if (flags['tag'] !== undefined) {
      const parsed = CacheTag.safeParse(flags['tag'])
      if (!parsed.success)
        throw new UsageError('--tag is *, a list (list:post) or an object tag (content:<id>, menus).')
      tag = parsed.data
    }
  } catch (err) {
    if (err instanceof UsageError) return usageResult(err.message, CACHE_USAGE)
    throw err
  }
  const outcome = await withDatabase(options, 'cache flush', async (db) => {
    await db.transaction(async (tx) => {
      await tx.insert(cacheInvalidation).values({ tag, changedAt: new Date() })
      await tx.insert(auditLog).values({
        actorType: 'system',
        actor: 'cli',
        accountId: null,
        action: 'cache.flushed',
        objectType: 'cache',
        objectId: tag,
        source: 'cli',
        ip: null,
      })
    })
  })
  if (isCliResult(outcome)) return outcome
  return {
    code: 0,
    stdout: tag === '*' ? 'The site cache is flushed.\n' : `The site cache is flushed for ${tag}.\n`,
    stderr: '',
  }
}

// ── jobs ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const JOB_STATES = ['created', 'retry', 'active', 'completed', 'cancelled', 'failed'] as const
const JobState = z.enum(JOB_STATES)
const Queue = z.string().regex(/^[a-z0-9._-]{1,100}$/)
const JobId = z.uuid()

interface JobRow extends Record<string, unknown> {
  id: string
  queue: string
  state: string
  retries: number
  created: string
  completed: string | null
}

/** The queue and state of a job, or undefined when there is none with that id. */
async function jobOf(db: Database, id: string): Promise<{ name: string; state: string } | undefined> {
  const result = await db.execute(sql`select name, state::text as state from pgboss.job where id = ${id}::uuid limit 1`)
  const row = z.object({ name: z.string(), state: z.string() }).safeParse(result.rows[0])
  return row.success ? row.data : undefined
}

/** `toa jobs list [--queue <name>] [--state <state>] [--limit n]`, `jobs retry <id>`, `jobs cancel <id>`. */
export async function jobs(args: readonly string[], options: CommandOptions = {}): Promise<CliResult> {
  const [action, ...rest] = args
  try {
    if (action === 'list') {
      const flags = parseFlags(rest, { queue: 'string', state: 'string', limit: 'string', format: 'string' })
      const format = Format.parse(flags['format'] ?? 'table')
      const queue = flags['queue'] === undefined ? undefined : Queue.parse(flags['queue'])
      const state = flags['state'] === undefined ? undefined : JobState.parse(flags['state'])
      const limit = z.coerce
        .number()
        .int()
        .min(1)
        .max(1000)
        .parse(flags['limit'] ?? '50')
      const outcome = await withDatabase(options, 'jobs list', async (db) => {
        // The job's data is left out: a mail job holds a sealed token and an address.
        const result = await db.execute(sql`
          select id::text, name as queue, state::text, retry_count as retries,
                 created_on::text as created, completed_on::text as completed
          from pgboss.job
          where (${queue ?? null}::text is null or name = ${queue ?? null})
            and (${state ?? null}::text is null or state::text = ${state ?? null})
          order by created_on desc
          limit ${limit}`)
        return result.rows as JobRow[]
      })
      if (isCliResult(outcome)) return outcome
      return {
        code: 0,
        stdout: render(outcome, ['id', 'queue', 'state', 'retries', 'created', 'completed'], format),
        stderr: '',
      }
    }
    if (action === 'retry' || action === 'cancel') {
      const [id, ...flagArgs] = rest
      parseFlags(flagArgs, {})
      const parsedId = JobId.safeParse(id)
      if (!parsedId.success) throw new UsageError(`Give the job's id (a UUID) after ${action}.`)
      const outcome = await withDatabase(options, `jobs ${action}`, async (db, _logger, config) => {
        const job = await jobOf(db, parsedId.data)
        if (job === undefined) return refusal('There is no job with that id.')
        // pg-boss changes only a failed job on retry, and only a waiting or running one on cancel: anything else is refused here,
        // so nothing is reported (or audited) that did not happen.
        if (action === 'retry' && job.state !== 'failed') return refusal(`The job is ${job.state}, not failed.`)
        if (action === 'cancel' && !['created', 'retry', 'active'].includes(job.state)) {
          return refusal(`The job is ${job.state}: it has already finished.`)
        }
        const queue = job.name
        // The app role's pg-boss: no supervision, no schedules, no schema work (AGENTS.md).
        const boss = new PgBoss({
          ...PGBOSS_APP_OPTIONS,
          connectionString: config.DATABASE_URL,
          supervise: false,
          schedule: false,
        })
        boss.on('error', () => undefined)
        await boss.start()
        try {
          if (action === 'retry') await boss.retry(queue, parsedId.data)
          else await boss.cancel(queue, parsedId.data)
        } finally {
          await boss.stop({ graceful: false })
        }
        await audit(db, action === 'retry' ? 'jobs.retried' : 'jobs.cancelled', 'job', parsedId.data, { queue })
        return queue
      })
      if (isCliResult(outcome)) return outcome
      return {
        code: 0,
        stdout:
          action === 'retry'
            ? `Job ${parsedId.data} (${outcome}) is queued again.\n`
            : `Job ${parsedId.data} (${outcome}) is cancelled.\n`,
        stderr: '',
      }
    }
    throw new UsageError('Say list, retry or cancel.')
  } catch (err) {
    if (err instanceof UsageError) return usageResult(err.message, JOBS_USAGE)
    if (err instanceof z.ZodError) return usageResult('A flag has a value it cannot have (see below).', JOBS_USAGE)
    throw err
  }
}

// ── secrets ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The secrets of an install: where each lives. The values are never read for this list, only whether they are set. */
const ENV_SECRETS = [
  ['TOASCRIBE_ENCRYPTION_KEY', 'encrypts the secrets in the database (SMTP password, TOTP secrets)'],
  ['TOASCRIBE_ENCRYPTION_OLD_KEYS', 'older encryption keys that must stay readable'],
  ['TOASCRIBE_SIGNING_KEY', 'signs the CSRF tokens (api only)'],
  ['DATABASE_URL', 'the app role and its password'],
] as const

/** The database, or a transaction on it. */
type Exec = Database | Parameters<Parameters<Database['transaction']>[0]>[0]

interface SealedStore {
  readonly name: string
  /** Every sealed value with what it is sealed for. */
  read(db: Exec): Promise<{ readonly key: string; readonly value: string; readonly aad: string }[]>
  write(db: Exec, key: string, value: string): Promise<void>
}

/** Where the database holds values sealed with the site key. Webhook secrets join when webhooks are built (phase 2). */
const STORES: readonly SealedStore[] = [
  {
    name: 'setting smtp_password',
    async read(db) {
      const [row] = await db.select({ value: setting.value }).from(setting).where(eq(setting.key, 'smtp_password'))
      return typeof row?.value === 'string' ? [{ key: 'smtp_password', value: row.value, aad: SMTP_PASSWORD_AAD }] : []
    },
    async write(db, _key, value) {
      await db
        .update(setting)
        .set({ value: sql`${JSON.stringify(value)}::jsonb`, modifiedAt: sql`now()` })
        .where(eq(setting.key, 'smtp_password'))
    },
  },
  {
    name: 'TOTP secrets',
    async read(db) {
      const rows = await db
        .select({ id: mfaCredential.id, value: mfaCredential.secretEncrypted })
        .from(mfaCredential)
        .where(isNotNull(mfaCredential.secretEncrypted))
      return rows.flatMap((row) =>
        row.value === null ? [] : [{ key: row.id, value: row.value, aad: `mfa_credential:${row.id}` }],
      )
    },
    async write(db, key, value) {
      await db.update(mfaCredential).set({ secretEncrypted: value }).where(eq(mfaCredential.id, key))
    },
  },
]

const versionOf = (value: string): number => Number(/^v(\d+):/.exec(value)?.[1] ?? 0)

const SecretsEnv = (env: EnvSource | undefined) => loadKeyedDatabaseConfig(env)

/** `toa secrets list [--format]`, `secrets rotate [--yes]`, `secrets rotate --new-key`. */
export async function secrets(args: readonly string[], options: CommandOptions = {}): Promise<CliResult> {
  const [action, ...rest] = args
  try {
    if (action === 'list') {
      const flags = parseFlags(rest, { format: 'string' })
      const format = Format.parse(flags['format'] ?? 'table')
      const set = new Set(
        namesSet(
          ENV_SECRETS.map(([name]) => name),
          options.env,
        ),
      )
      const outcome = await withConfiguredDatabase(options, 'secrets list', SecretsEnv, async (db, _logger, config) => {
        const rows: Record<string, unknown>[] = ENV_SECRETS.map(([name, what]) => ({
          name,
          where: 'environment',
          set: set.has(name) ? 'yes' : 'no',
          what,
        }))
        for (const store of STORES) {
          const values = await store.read(db)
          const versions = [...new Set(values.map((entry) => versionOf(entry.value)))]
            .sort()
            .map((v) => `v${String(v)}`)
          rows.push({
            name: store.name,
            where: 'database',
            set: values.length === 0 ? 'no' : `${String(values.length)} (key ${versions.join(', ')})`,
            what: `sealed with the site key; current key v${String(config.TOASCRIBE_ENCRYPTION_KEY_VERSION)}`,
          })
        }
        return rows
      })
      if (isCliResult(outcome)) return outcome
      return { code: 0, stdout: render(outcome, ['name', 'where', 'set', 'what'], format), stderr: '' }
    }
    if (action === 'rotate') {
      const flags = parseFlags(rest, { yes: 'boolean', 'new-key': 'boolean' })
      if (flags['new-key'] === true) return newKeySteps(currentKeyVersion(options.env), highestKeyVersion(options.env))
      return await rotate(options, flags['yes'] === true)
    }
    if (action === 'export') return await secretsExport(rest, options)
    if (action === 'import') return await secretsImport(rest, options)
    throw new UsageError('Say list, rotate, export or import.')
  } catch (err) {
    if (err instanceof UsageError) return usageResult(err.message, SECRETS_USAGE)
    if (err instanceof z.ZodError) return usageResult('A flag has a value it cannot have (see below).', SECRETS_USAGE)
    throw err
  }
}

/** Step 1 of a rotation: a new key and what to do with it. The current key is not printed (it is already in .env). */
function newKeySteps(current: number, highest: number): CliResult {
  const next = highest + 1
  const key = randomBytes(32).toString('hex')
  return {
    code: 0,
    stdout:
      `A new encryption key, version ${String(next)}. In docker/.env:\n` +
      `  1. Add the current key to TOASCRIBE_ENCRYPTION_OLD_KEYS as v${String(current)}:<the current TOASCRIBE_ENCRYPTION_KEY>\n` +
      `     (comma-separated with any older ones), so what it sealed stays readable.\n` +
      `  2. Set TOASCRIBE_ENCRYPTION_KEY=${key}\n` +
      `  3. Set TOASCRIBE_ENCRYPTION_KEY_VERSION=${String(next)}\n` +
      `  4. Restart: docker compose up -d\n` +
      `  5. Run toa secrets rotate, which seals every stored secret again with the new key.\n` +
      `  6. Keep the old key in TOASCRIBE_ENCRYPTION_OLD_KEYS for a day (queued mails carry tokens sealed with it), then remove it.\n` +
      `Back the new key up outside the server: without it the stored secrets cannot be read.\n`,
    stderr: '',
  }
}

const ROTATE_WARNING =
  'WARNING: this seals every secret in the database again with the current key (TOASCRIBE_ENCRYPTION_KEY, version {v}). ' +
  'Keep the older keys in TOASCRIBE_ENCRYPTION_OLD_KEYS until it has finished and queued mails are sent; a key removed too ' +
  'early leaves what it sealed unreadable. Take a backup first (toa backup create).'

/** Step 2: every sealed value read with the key ring (any version) and written again with the current one, in one transaction. */
async function rotate(options: CommandOptions, yes: boolean): Promise<CliResult> {
  const outcome = await withConfiguredDatabase(options, 'secrets rotate', SecretsEnv, async (db, logger, config) => {
    const ring: KeyRing = await keyRingOf(config)
    const warning = ROTATE_WARNING.replace('{v}', String(ring.currentVersion))
    if (!yes) {
      const prompt = options.prompt ?? createTerminalPrompter()
      if (!prompt.interactive) return invalidInput(`${warning}\nRun it in a terminal to confirm, or add --yes.`)
      prompt.say(`${warning}\n`)
      const answer = await prompt.ask('Type «roter» to go on: ')
      if (answer.trim() !== 'roter') return refusal('Nothing was changed.')
    }
    let resealed = 0
    let current = 0
    await db.transaction(async (tx) => {
      for (const store of STORES) {
        for (const entry of await store.read(tx)) {
          if (versionOf(entry.value) === ring.currentVersion) {
            current += 1
            continue
          }
          let plain: string
          try {
            plain = await ring.decrypt(entry.value, entry.aad)
          } catch {
            // Names the row (an id, not a secret) so the operator can find it; nothing was changed.
            throw new Error(
              `${store.name} ${entry.key}: cannot be read with the keys given (key v${String(versionOf(entry.value))} missing from TOASCRIBE_ENCRYPTION_OLD_KEYS?)`,
            )
          }
          await store.write(tx, entry.key, await ring.encrypt(plain, entry.aad))
          resealed += 1
        }
      }
      await tx.insert(auditLog).values({
        actorType: 'system',
        actor: 'cli',
        accountId: null,
        action: 'secrets.rotated',
        objectType: 'system',
        objectId: 'encryption_key',
        newValue: { version: ring.currentVersion, resealed, alreadyCurrent: current },
        source: 'cli',
        ip: null,
      })
    })
    logger.info({ version: ring.currentVersion, resealed }, 'secrets sealed again')
    return { resealed, current, version: ring.currentVersion }
  })
  if (isCliResult(outcome)) return outcome
  return {
    code: 0,
    stdout:
      `Sealed ${String(outcome.resealed)} secret(s) again with key version ${String(outcome.version)}; ` +
      `${String(outcome.current)} already used it.\n`,
    stderr: '',
  }
}
