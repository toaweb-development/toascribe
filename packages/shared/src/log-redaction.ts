// What never reaches a log line or a trace (M1.8, K-297, K-298; security §8): one fixed list of field names whose values are hidden
// wherever they sit in a logged object, and in every string an e-mail address, a `Bearer`/`Basic` credential and the user and
// password of an address. The api, the worker, the cli and the Nuxt servers all write their lines through `scrubForLog`, and the
// OpenTelemetry span processor uses the same rules for span attributes.

/** What a hidden value becomes. */
export const LOG_REDACTED = '[skjult]'

/**
 * Field names whose value is never logged, compared without case and without `-` and `_` (`set-cookie`, `Set_Cookie` and
 * `setCookie` are the same name). Any name ending in `password`, `token` or `secret` is hidden too.
 */
export const REDACTED_LOG_FIELDS: readonly string[] = [
  'password',
  'passwd',
  'token',
  'secret',
  'authorization',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'apikey',
  'privatekey',
  'recoverykey',
  'identity',
  'csrf',
  'xcsrftoken',
  'xsetuptoken',
  'email',
  'to',
  'recipient',
  'newemail',
  'oldemail',
  'databaseurl',
  'connectionstring',
]

const FIELDS = new Set(REDACTED_LOG_FIELDS)

function normalizedName(name: string): string {
  return name.toLowerCase().replace(/[-_]/g, '')
}

/** Whether a field of this name is hidden. */
export function isRedactedField(name: string): boolean {
  const key = normalizedName(name)
  return FIELDS.has(key) || key.endsWith('password') || key.endsWith('token') || key.endsWith('secret')
}

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const CREDENTIAL = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi

/** A string with e-mail addresses, credentials and the user of an address hidden. */
export function scrubLogText(text: string): string {
  return text
    .replace(URL_USERINFO, `$1${LOG_REDACTED}@`)
    .replace(CREDENTIAL, `$1 ${LOG_REDACTED}`)
    .replace(EMAIL, LOG_REDACTED)
}

const MAX_DEPTH = 8

/** A copy of a log object with the fixed fields hidden at any depth and every string scrubbed. Never changes its input. */
export function scrubForLog<T>(value: T, depth = 0): T {
  if (typeof value === 'string') return scrubLogText(value) as T
  if (value === null || typeof value !== 'object' || depth > MAX_DEPTH) return value
  if (Array.isArray(value)) return value.map((entry: unknown) => scrubForLog(entry, depth + 1)) as T
  if (value instanceof Date) return value
  if (value instanceof Error) {
    // As pino's own error serialiser would write it (the log is the server's: the stack stays), every string scrubbed.
    const code: unknown = Reflect.get(value, 'code')
    return {
      type: value.name,
      message: scrubLogText(value.message),
      ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
      ...(value.stack === undefined ? {} : { stack: scrubLogText(value.stack) }),
      ...(value.cause === undefined ? {} : { cause: scrubForLog(value.cause, depth + 1) }),
    } as T
  }
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    out[key] = isRedactedField(key)
      ? entry === null || entry === undefined
        ? entry
        : LOG_REDACTED
      : scrubForLog(entry, depth + 1)
  }
  return out as T
}

/**
 * For pino's `hooks.logMethod`: the message text and any other string argument scrubbed too (`formatters.log` sees only the
 * object). `this` is pino's logger.
 */
export function scrubLogArguments(args: unknown[]): unknown[] {
  return args.map((arg) => (typeof arg === 'string' ? scrubLogText(arg) : arg))
}

/** A request id as it may travel between the site, the api and a job: letters, digits, `-` and `_`, at most 128. */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
