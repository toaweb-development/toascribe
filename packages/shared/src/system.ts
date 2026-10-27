import { z } from 'zod'

// POST /api/v1/system/test-email (K-204): an administrator asks for a test mail to see that the SMTP settings work.

export const TestEmailRequest = z.strictObject({
  /** Where to send it. Default: the signed-in account's own address. */
  to: z.email().max(254).optional(),
})
export type TestEmailRequest = z.infer<typeof TestEmailRequest>

/** 202: the mail is queued, not yet sent. `jobId` is the queue's id for it (for the logs). */
export const TestEmailResponse = z.object({ jobId: z.string().min(1) })
export type TestEmailResponse = z.infer<typeof TestEmailResponse>

// «Oppdateringer» (M1.7, K-290): GET /api/v1/updates and PATCH /api/v1/updates/settings, with `update_core`. The admin cannot update
// the containers; it shows what is installed, the newest release found and the command to run on the host.

/** The repository whose releases are looked for, and whose CHANGELOG.md the page links to. */
export const RELEASE_REPOSITORY = 'toaweb-development/toascribe'

export const UpdatesResponse = z.object({
  /** The version that runs. */
  current: z.string(),
  /** The `update_check` setting. */
  enabled: z.boolean(),
  /** TOASCRIBE_UPDATE_CHECK=off on the server: no check, whatever the setting says. */
  disabledByServer: z.boolean(),
  /** The last check, or null when none has run. */
  status: z
    .object({
      checkedAt: z.iso.datetime(),
      ok: z.boolean(),
      latest: z.string().nullable(),
      /** A release newer than `current` was found. */
      available: z.boolean(),
    })
    .nullable(),
  /** CHANGELOG.md at the newest release found, when it is newer than the one that runs. */
  changelogUrl: z.url().nullable(),
})
export type UpdatesResponse = z.infer<typeof UpdatesResponse>

export const UpdateUpdatesSettingsRequest = z.strictObject({ enabled: z.boolean() })
export type UpdateUpdatesSettingsRequest = z.infer<typeof UpdateUpdatesSettingsRequest>

// «Verktøy → Nettstedshelse → Info» (M1.7, K-203): GET /api/v1/site-health/info, with `manage_options`. Groups of fields the screen
// labels through i18n (`siteHealth.groups.<group>`, `siteHealth.fields.<group>.<field>`), and the same as plain English text for
// «Kopier til utklippstavlen», with e-mail addresses, addresses, paths and anything that looks like a token or key replaced by
// `[skjult]`. No field holds a secret in the first place.

export const SITE_HEALTH_GROUPS = [
  'toascribe',
  'server',
  'database',
  'cache',
  'worker',
  'site',
  'media',
  'backup',
  'updates',
] as const
export type SiteHealthGroupKey = (typeof SITE_HEALTH_GROUPS)[number]

/** How the screen shows a value: as it is, as bytes, as a time, as yes/no, or as a word with its own label (`siteHealth.values.<v>`). */
export const SITE_HEALTH_KINDS = ['text', 'bytes', 'datetime', 'boolean', 'word', 'number'] as const

export const SiteHealthField = z.object({
  key: z.string().regex(/^[a-zA-Z]+$/),
  kind: z.enum(SITE_HEALTH_KINDS),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
})
export type SiteHealthField = z.infer<typeof SiteHealthField>

export const SiteHealthGroup = z.object({
  key: z.enum(SITE_HEALTH_GROUPS),
  fields: z.array(SiteHealthField),
})
export type SiteHealthGroup = z.infer<typeof SiteHealthGroup>

export const SiteHealthInfoResponse = z.object({
  groups: z.array(SiteHealthGroup),
  /** The copy for support, redacted (`redactForCopy`). */
  text: z.string(),
})
export type SiteHealthInfoResponse = z.infer<typeof SiteHealthInfoResponse>

/** What replaces a hidden value in the copy. */
export const REDACTED = '[skjult]'

const REDACTIONS: readonly RegExp[] = [
  // name=value and name: value where the name says it is secret
  /\b[\w.-]*(?:password|passwd|secret|token|apikey|api_key|key|cookie|session|auth)[\w.-]*\s*[=:]\s*\S+/gi,
  // an address with a scheme (it may carry a user, a password or a token)
  /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi,
  // an e-mail address
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
]

/** An absolute path (Unix, home, Windows), but not a permalink structure (`/%postname%/`). */
function isPath(word: string): boolean {
  return /^(?:~|[A-Za-z]:)?[/\\]./.test(word) && !word.includes('%')
}

/** A run that looks random: a long hex string, a mix of upper case, lower case and digits, or a long lower-case code (age1…). */
function isToken(run: string): boolean {
  if (/^[0-9a-fA-F]{24,}$/.test(run)) return true
  const count = (pattern: RegExp) => (run.match(pattern) ?? []).length
  if (count(/[A-Z]/g) >= 3 && count(/[a-z]/g) >= 3 && count(/\d/g) >= 3) return true
  return run.length >= 40 && count(/\d/g) >= 8
}

/** A value for the copy, with anything that may identify the server or be a secret replaced by REDACTED. */
export function redactForCopy(value: string): string {
  let text = value
  for (const pattern of REDACTIONS) text = text.replace(pattern, REDACTED)
  return text
    .split(/(\s+)/)
    .map((word) =>
      isPath(word) ? REDACTED : word.replace(/[A-Za-z0-9_+/=-]{20,}/g, (run) => (isToken(run) ? REDACTED : run)),
    )
    .join('')
}

/** The plain-text copy of the groups: `### group` and `field: value` lines, every value through redactForCopy. */
export function siteHealthText(groups: readonly SiteHealthGroup[]): string {
  return groups
    .map((group) => {
      const lines = group.fields.map((field) => `${field.key}: ${redactForCopy(String(field.value ?? '-'))}`)
      return [`### ${group.key}`, ...lines].join('\n')
    })
    .join('\n\n')
    .concat('\n')
}
