import { z } from 'zod'

import { LoginResponse } from './auth.ts'
import { CoreSettings, SMTP_SECURE_MODES } from './settings.ts'
import { NewPassword } from './password.ts'
import { Username } from './auth-flows.ts'

// The request and response shapes of /api/v1/setup/* (M0.4; PLAN «Installasjon og drift»). The setup wizard and
// `toa core install` run the same install service; these are the shapes of the wizard's side. Inputs are strict objects,
// as in auth.ts. Names are camelCase; a setting keeps its own value rules (`CoreSettings`), so the wizard cannot save
// what the settings page would refuse.

const CONTROL_CHARACTER = /\p{Cc}/u

const Email = z.email().max(254)

/**
 * One line of text without control characters, so a value cannot break a mail header. Checked with a `refine` and not the
 * settings' own `regex(/.../u)`: a regular expression with a flag ends up in the OpenAPI document as a pattern that other tools
 * cannot read. The settings still check the same rule when the value is saved.
 */
const line = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !CONTROL_CHARACTER.test(value), { message: 'Must be one line, without control characters' })

/**
 * The header that carries the one-time setup token. A header and never a query string: the api's own log and the proxy's log
 * would otherwise keep the token. The address that is printed and logged carries it in the fragment (`/admin/setup#token=…`), which a browser never sends;
 * the wizard reads it from there once, moves it into memory and removes it from the address bar.
 */
export const SETUP_TOKEN_HEADER = 'x-setup-token'

/** What a setup token can look like: `generateToken()` makes 43 characters of base64url. Anything else cannot be one. */
export const SetupToken = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/)

/**
 * The steps of the wizard. `check` is the system check, where it starts; the others are saved by the api as they are
 * completed, so a reload picks up where it was left. Creating the administrator and the default content is the last act
 * (`install`), not a step that can be saved.
 */
export const SETUP_STEP = ['check', 'site', 'email', 'admin'] as const
export const SetupStep = z.enum(SETUP_STEP)
export type SetupStep = z.infer<typeof SetupStep>

/** GET /setup/status, open to anyone: whether the site is installed, and if not, the first step that is not saved yet. Nothing else. */
export const SetupStatusResponse = z.object({
  installed: z.boolean(),
  /** Null once installed. */
  nextStep: SetupStep.nullable(),
})
export type SetupStatusResponse = z.infer<typeof SetupStatusResponse>

/** POST /setup/token/verify: the header held a valid token. */
export const SetupTokenVerifyResponse = z.object({ valid: z.literal(true), nextStep: SetupStep })
export type SetupTokenVerifyResponse = z.infer<typeof SetupTokenVerifyResponse>

// ── System check ─────────────────────────────────────────────

export const PROXY_CHECK_STATE = ['configured', 'watching', 'ok', 'warning'] as const
export const ProxyCheckState = z.enum(PROXY_CHECK_STATE)
export type ProxyCheckState = z.infer<typeof ProxyCheckState>

/** Where the address the browser uses was read from, in the order the check prefers. */
export const OBSERVED_ORIGIN_SOURCE = ['origin', 'referer', 'forwarded', 'host'] as const
export const ObservedOriginSource = z.enum(OBSERVED_ORIGIN_SOURCE)
export type ObservedOriginSource = z.infer<typeof ObservedOriginSource>

/**
 * GET /setup/check. Nothing here is a secret: keys are reported as present and valid, never by value. The two origins are
 * the site's own address (`PUBLIC_ORIGIN`) and the one this request came in on; the browser's address is not a secret.
 */
export const SetupCheckResponse = z.object({
  /** True when nothing blocks the install: the database answers, the migrations are applied, both keys are valid and the origin matches. The proxy warning does not block. */
  ok: z.boolean(),
  database: z.object({ ok: z.boolean() }),
  migrations: z.object({
    ok: z.boolean(),
    applied: z.int().min(0),
    expected: z.int().min(0),
    /** The newest migration this build ships. */
    latest: z.string(),
  }),
  /** `TOASCRIBE_ENCRYPTION_KEY`: it is validated when the api starts, so a running api has a valid one. */
  encryptionKey: z.object({ ok: z.boolean(), version: z.int().min(1) }),
  /** `TOASCRIBE_SIGNING_KEY`: the same. */
  signingKey: z.object({ ok: z.boolean() }),
  /** The M0.3 proxy check (`TOASCRIBE_TRUSTED_PROXY`). Informational. */
  proxy: z.object({
    state: ProxyCheckState,
    observed: z.int().min(0),
    address: z.string().nullable(),
  }),
  /** `PUBLIC_ORIGIN` against the address the browser used. */
  origin: z.object({
    ok: z.boolean(),
    configured: z.string(),
    /** Null when the request carried nothing to tell it by. */
    observed: z.string().nullable(),
    source: ObservedOriginSource.nullable(),
  }),
})
export type SetupCheckResponse = z.infer<typeof SetupCheckResponse>

// ── Site ─────────────────────────────────────────────────────

/** An IANA time zone the runtime knows (`Europe/Oslo`) or `UTC`. */
export const SetupTimezone = CoreSettings.shape.timezone_string.refine(
  (zone) => {
    if (zone === '') {
      return false
    }
    try {
      new Intl.DateTimeFormat('en', { timeZone: zone })
      return true
    } catch {
      return false
    }
  },
  { message: 'Not a known time zone' },
)

/** The «Nettstedet» step: language, title, time zone, the site's e-mail address, and whether search engines may index it. */
export const SetupSite = z.strictObject({
  /** The language of the site and of its default content (`nb`, or another tag; only `nb` has bokmål text, any other gets English). */
  locale: CoreSettings.shape.locale,
  /** `blogname`. Trimmed; one line. */
  title: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((value) => !CONTROL_CHARACTER.test(value), { message: 'Must be one line, without control characters' }),
  timezone: SetupTimezone,
  /** `admin_email`: where the site sends its notices. */
  adminEmail: Email,
  /** `blog_public`. False is «Be søkemotorer om ikke å indeksere dette nettstedet». */
  blogPublic: z.boolean(),
})
export type SetupSite = z.infer<typeof SetupSite>

/** PUT /setup/site, 200: what was saved. */
export const SetupSiteResponse = z.object({ site: SetupSite, nextStep: SetupStep })
export type SetupSiteResponse = z.infer<typeof SetupSiteResponse>

// ── E-mail ───────────────────────────────────────────────────

/**
 * The «E-post» step: the SMTP server and the sender. Saved as the `smtp_*` and `mail_from_*` settings. The password is
 * encrypted with the site key before it is stored and is never sent back.
 */
export const SetupEmail = z.strictObject({
  host: CoreSettings.shape.smtp_host.unwrap(),
  /** Default by encryption: `tls` 465, `starttls` 587, `none` 25. */
  port: CoreSettings.shape.smtp_port.unwrap().optional(),
  secure: z.enum(SMTP_SECURE_MODES),
  /** Empty or left out: no login (an open relay on a trusted network). */
  username: line(320).or(z.literal('')).optional(),
  /**
   * Left out: keep the password that is stored (a reload of the wizard does not know it). An empty string removes it. Never
   * sent back.
   */
  password: z.string().max(1000).optional(),
  /** The From address. */
  fromAddress: Email,
  /** The From name; left out uses the site title. */
  fromName: line(200).or(z.literal('')).optional(),
})
export type SetupEmail = z.infer<typeof SetupEmail>

/** What is saved of the e-mail step: as `SetupEmail`, but the password is only said to be there. */
export const SetupEmailSaved = z.object({
  host: z.string(),
  port: z.int(),
  secure: z.enum(SMTP_SECURE_MODES),
  username: z.string().nullable(),
  smtpPasswordSet: z.boolean(),
  fromAddress: z.string(),
  fromName: z.string().nullable(),
})
export type SetupEmailSaved = z.infer<typeof SetupEmailSaved>

/** PUT /setup/email, 200. */
export const SetupEmailResponse = z.object({ email: SetupEmailSaved, nextStep: SetupStep })
export type SetupEmailResponse = z.infer<typeof SetupEmailResponse>

/** POST /setup/email/test: the address that gets the test mail. */
export const SetupEmailTestRequest = z.strictObject({ to: Email })
export type SetupEmailTestRequest = z.infer<typeof SetupEmailTestRequest>

/** Why a test mail did not arrive. Codes, never the text of the SMTP server's answer (it can hold an address or a user name). */
export const EMAIL_TEST_ERROR = ['send_failed', 'mail_config', 'timeout', 'queue_unavailable', 'busy'] as const
export const EmailTestError = z.enum(EMAIL_TEST_ERROR)
export type EmailTestError = z.infer<typeof EmailTestError>

/**
 * POST /setup/email/test, 200 whatever the outcome (a mail that did not go is a result, not an error of the request).
 * `ok` is true only when the worker's job completed, so the mail was handed to the SMTP server.
 */
export const SetupEmailTestResponse = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: EmailTestError }),
])
export type SetupEmailTestResponse = z.infer<typeof SetupEmailTestResponse>

/** POST /setup/email/skip, 200: the step is skipped and a notice for the dashboard is stored. */
export const SetupEmailSkipResponse = z.object({ skipped: z.literal(true), nextStep: SetupStep })
export type SetupEmailSkipResponse = z.infer<typeof SetupEmailSkipResponse>

// ── State (for a reload) ─────────────────────────────────────

/** GET /setup/state: what is saved so far, so a reload of the wizard fills its forms again. Never a secret. */
export const SetupStateResponse = z.object({
  nextStep: SetupStep,
  site: SetupSite.nullable(),
  email: SetupEmailSaved.nullable(),
  emailSkipped: z.boolean(),
})
export type SetupStateResponse = z.infer<typeof SetupStateResponse>

// ── Recovery key and install ─────────────────────────────────

/**
 * The recovery key for backups, as shown: eight groups of four letters and digits (Crockford's base32, no I, L, O, U),
 * 160 bits. The server keeps only a verifier. Case, hyphens and spaces do not matter when it is typed back.
 */
export const RECOVERY_KEY_PATTERN = /^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){7}$/
export const RecoveryKey = z.string().regex(RECOVERY_KEY_PATTERN)

/** POST /setup/recovery-key, 200: a new key. It is shown once; asking again makes another and the earlier one stops working. */
export const SetupRecoveryKeyResponse = z.object({ recoveryKey: RecoveryKey })
export type SetupRecoveryKeyResponse = z.infer<typeof SetupRecoveryKeyResponse>

/** The first administrator. The same rules as everywhere else an account is made. */
export const SetupAdmin = z.strictObject({
  username: Username,
  email: Email,
  password: NewPassword,
})
export type SetupAdmin = z.infer<typeof SetupAdmin>

/**
 * POST /setup/install. `recoveryKey` is the key the page was shown, sent back so the server can see it is the one it made;
 * `confirmed` must be true: the person has said they saved it (Tor: «brukeren må bekrefte at den er lagret»).
 */
export const SetupInstallRequest = z.strictObject({
  admin: SetupAdmin,
  recoveryKey: z.string().min(1).max(64),
  confirmed: z.literal(true),
})
export type SetupInstallRequest = z.infer<typeof SetupInstallRequest>

/**
 * POST /setup/install, 200. The site is installed and the new administrator is signed in: `login` is the same body as
 * after POST /auth/login (the session cookie is set in the response). `login` is null only if the session could not be
 * made after the install had committed; sign in at /admin/login then.
 */
export const SetupInstallResponse = z.object({
  installed: z.literal(true),
  login: LoginResponse.nullable(),
})
export type SetupInstallResponse = z.infer<typeof SetupInstallResponse>
