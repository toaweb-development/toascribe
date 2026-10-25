import { z } from 'zod'

import { LoginPassword } from './password.ts'
import { Preferences } from './preferences.ts'

// The request and response shapes of /api/v1/auth/* and /api/v1/me/* (PLAN «API-endepunktkart»). Inputs are strict
// objects: an unknown field is an error, never silently dropped, so a client cannot slip in a field the api does not
// expect (mass assignment, security §5). JSON field names are camelCase; dates are ISO 8601 strings.

// The control-character checks are `refine`s, not `regex`es: a regex with the `u` flag ends up in the OpenAPI document as a
// pattern that other tools cannot read.

const CONTROL_CHARACTER = /\p{Cc}/u
const CONTROL_EXCEPT_LINE_BREAKS = /(?![\t\n\r])\p{Cc}/u

/** One line of text: no control characters (tab, CR and LF included). */
const oneLine = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !CONTROL_CHARACTER.test(value), { message: 'Must be one line, without control characters' })

/** Free text with line breaks, without the other control characters. */
const multiLine = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !CONTROL_EXCEPT_LINE_BREAKS.test(value), { message: 'Must not contain control characters' })

// ── Profile (K-011) ──────────────────────────────────────────

/** «Display name publicly as» on WordPress' profile page: which of the name parts the display name is built from. */
export const DISPLAY_NAME_CHOICE = [
  'username',
  'first_name',
  'last_name',
  'first_last',
  'last_first',
  'nickname',
] as const
export const DisplayNameChoice = z.enum(DISPLAY_NAME_CHOICE)
export type DisplayNameChoice = z.infer<typeof DisplayNameChoice>

/** An empty string means «none». A website is an http or https address, never `javascript:` or `data:` (security §4). */
const website = z.union([z.literal(''), z.url({ protocol: /^https?$/ }).max(2000)])

/**
 * The profile fields kept in `account.profile` (the JSON has exactly these keys). E-mail is not one of them: it changes
 * only through the e-mail-change flow, which confirms the new address by link (K-012).
 */
export const ProfileFields = z.object({
  firstName: oneLine(100),
  lastName: oneLine(100),
  nickname: oneLine(100),
  website,
  bio: multiLine(5000),
  displayNameChoice: DisplayNameChoice,
})
export type ProfileFields = z.infer<typeof ProfileFields>

/** What `profile` holds for an account that never saved one. */
export const EMPTY_PROFILE: ProfileFields = {
  firstName: '',
  lastName: '',
  nickname: '',
  website: '',
  bio: '',
  displayNameChoice: 'username',
}

/** PATCH /me: any of the profile fields. At least one. */
export const UpdateMeRequest = z
  .strictObject({
    firstName: ProfileFields.shape.firstName,
    lastName: ProfileFields.shape.lastName,
    nickname: ProfileFields.shape.nickname,
    website: ProfileFields.shape.website,
    bio: ProfileFields.shape.bio,
    displayNameChoice: ProfileFields.shape.displayNameChoice,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Send at least one field' })
export type UpdateMeRequest = z.infer<typeof UpdateMeRequest>

// ── Accounts and sessions ────────────────────────────────────

const isoDate = z.iso.datetime({ offset: true })

/** The account as the signed-in person sees it. `roles` are slugs; `capabilities` is the union over all roles. */
export const SessionAccount = z.object({
  id: z.uuid(),
  username: z.string(),
  email: z.string(),
  displayName: z.string(),
  locale: z.string().nullable(),
  roles: z.array(z.string()),
  capabilities: z.array(z.string()),
})
export type SessionAccount = z.infer<typeof SessionAccount>

/**
 * Where the second-factor step stands for a session that has passed the password but not the second factor.
 * `verification`: the account has a factor and must enter a code. `enrolment`: its role requires a factor and it has none.
 */
export const MFA_PENDING = ['verification', 'enrolment'] as const
export const MfaPending = z.enum(MFA_PENDING)
export type MfaPending = z.infer<typeof MfaPending>

/** Signed in: password (and second factor, where one is needed) passed. */
export const AuthenticatedSession = z.object({
  status: z.literal('authenticated'),
  /** Send it in `X-CSRF-Token` on every POST, PATCH, PUT and DELETE (K-258). It belongs to this session only. */
  csrfToken: z.string().min(1),
  account: SessionAccount,
  expiresAt: isoDate,
})
export type AuthenticatedSession = z.infer<typeof AuthenticatedSession>

/** The password was right, a second factor is still needed. The session may do nothing else until it is passed. */
export const MfaRequiredSession = z.object({
  status: z.literal('mfa_required'),
  mfa: MfaPending,
  csrfToken: z.string().min(1),
  expiresAt: isoDate,
})
export type MfaRequiredSession = z.infer<typeof MfaRequiredSession>

export const AnonymousSession = z.object({ status: z.literal('anonymous') })
export type AnonymousSession = z.infer<typeof AnonymousSession>

/** GET /auth/session: always 200, so the admin can ask who is signed in without an error in the console. */
export const SessionResponse = z.discriminatedUnion('status', [
  AnonymousSession,
  AuthenticatedSession,
  MfaRequiredSession,
])
export type SessionResponse = z.infer<typeof SessionResponse>

/** POST /auth/login. `login` is a username or an e-mail address. */
export const LoginRequest = z.strictObject({
  // No control characters: a NUL byte cannot be stored in text, and the name is looked up in the database.
  login: oneLine(320).min(1),
  password: LoginPassword,
  /** «Remember me»: the long session (14 days by default) and a persistent cookie. */
  remember: z.boolean().default(false),
  /** Where to go after login (`redirect_to`). Only a same-origin path is kept; see safeRedirectPath. */
  redirectTo: z.string().max(4096).optional(),
})
export type LoginRequest = z.infer<typeof LoginRequest>

/** POST /auth/login, 200. `redirectTo` is always a safe path (the sent one, or `/admin`). */
export const LoginResponse = z.discriminatedUnion('status', [
  AuthenticatedSession.extend({ redirectTo: z.string() }),
  MfaRequiredSession.extend({ redirectTo: z.string() }),
])
export type LoginResponse = z.infer<typeof LoginResponse>

/** One row of «active sessions» (K-013). */
export const SessionListItem = z.object({
  id: z.uuid(),
  createdAt: isoDate,
  lastSeenAt: isoDate,
  expiresAt: isoDate,
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  isRemembered: z.boolean(),
  /** The session that made this request. */
  isCurrent: z.boolean(),
})
export type SessionListItem = z.infer<typeof SessionListItem>

export const SessionListResponse = z.object({ sessions: z.array(SessionListItem) })
export type SessionListResponse = z.infer<typeof SessionListResponse>

/** DELETE /me/sessions: how many other sessions were ended. */
export const RevokeSessionsResponse = z.object({ revoked: z.int().min(0) })
export type RevokeSessionsResponse = z.infer<typeof RevokeSessionsResponse>

/**
 * An e-mail change the account has asked for and not yet confirmed (K-012): the address the link was mailed to, and until when
 * the link works. The token itself is never shown.
 */
export const PendingEmailChange = z.object({ email: z.string(), expiresAt: isoDate })
export type PendingEmailChange = z.infer<typeof PendingEmailChange>

/**
 * GET and PATCH /me. `pendingEmail` is the newest unused, unexpired e-mail change request of this account, or null. Only the
 * account itself gets it (it is /me).
 */
export const MeResponse = SessionAccount.extend({
  profile: ProfileFields,
  preferences: Preferences,
  pendingEmail: PendingEmailChange.nullable(),
})
export type MeResponse = z.infer<typeof MeResponse>

export const SessionIdParams = z.object({ id: z.uuid() })
export type SessionIdParams = z.infer<typeof SessionIdParams>
