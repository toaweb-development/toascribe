import { z } from 'zod'

import { AuthenticatedSession } from './auth.ts'
import { MailToken } from './mail.ts'
import { LoginPassword, NewPassword } from './password.ts'

// The request and response shapes of the account flows under /api/v1/auth and /api/v1/me: second factor (K-023), lost
// password (K-003), registration (K-005), e-mail change (K-012) and password change (K-013). Inputs are strict objects, as in
// auth.ts. Dates are ISO 8601 strings.

const isoDate = z.iso.datetime({ offset: true })
const CONTROL_CHARACTER = /\p{Cc}/u

const oneLine = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !CONTROL_CHARACTER.test(value), { message: 'Must be one line, without control characters' })

const Email = z.email().max(254)

/** The token in a one-time link, as `generateToken()` makes it (base64url, 256 bits). Anything else cannot be a token. */
export const OneTimeToken = MailToken
export type OneTimeToken = z.infer<typeof OneTimeToken>

/** What a flow that never says whether an account exists answers: the same body whatever happened (K-004). */
export const AcceptedResponse = z.object({ status: z.literal('accepted') })
export type AcceptedResponse = z.infer<typeof AcceptedResponse>

/** GET /auth/options: what the login screens need to know before anyone is signed in. */
export const AuthOptionsResponse = z.object({
  /** The setting «Anyone can register» (K-005): whether to show the register link. */
  registrationOpen: z.boolean(),
  /** The setting `blogname`, for the login screens (K-001). An empty string when it is not set: the screen falls back to its own name. */
  siteName: z.string(),
})
export type AuthOptionsResponse = z.infer<typeof AuthOptionsResponse>

// ── Lost password, set password (K-003, K-004, K-005) ────────

/** POST /auth/password/lost: a username or an e-mail address. Always answers 202, whether or not the account exists. */
export const LostPasswordRequest = z.strictObject({ login: oneLine(320).min(1) })
export type LostPasswordRequest = z.infer<typeof LostPasswordRequest>

/**
 * POST /auth/password/reset (the link of «Lost your password?») and POST /auth/password/set (the welcome link of a new or
 * registered account). Two routes, one shape: a token only works on the route of its own purpose.
 */
export const ChoosePasswordRequest = z.strictObject({ token: OneTimeToken, password: NewPassword })
export type ChoosePasswordRequest = z.infer<typeof ChoosePasswordRequest>

// ── Registration (K-005) ─────────────────────────────────────

/** A username someone picks: letters and digits first, then also `.`, `_`, `-` and `@`. No spaces. */
export const Username = z
  .string()
  .min(3)
  .max(60)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._@-]*$/)
export type Username = z.infer<typeof Username>

/** POST /auth/register. Always answers 202, whether or not the username or the address was free. */
export const RegisterRequest = z.strictObject({ username: Username, email: Email })
export type RegisterRequest = z.infer<typeof RegisterRequest>

// ── Second factor (K-023) ────────────────────────────────────

/** Six digits from the authenticator app. A space in the middle («123 456») and around it is allowed. */
export const TotpCode = z.string().regex(/^\s*\d{3}\s?\d{3}\s*$/)

/** A recovery code as printed (`ABCD-EFGH-JKMN-PQRS`); case, hyphens and spaces do not matter. */
export const RecoveryCodeInput = z.string().min(8).max(40)

/** POST /auth/mfa/verify: the code of the authenticator app, or one recovery code. */
export const MfaVerifyRequest = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('totp'), code: TotpCode }),
  z.strictObject({ type: z.literal('recovery'), code: RecoveryCodeInput }),
])
export type MfaVerifyRequest = z.infer<typeof MfaVerifyRequest>

/** 200 from /auth/mfa/verify: the session is now complete. The CSRF token is the same as before. */
export const MfaVerifyResponse = AuthenticatedSession.extend({
  /** Unused recovery codes left after this login; null when a code from the app was used. */
  recoveryCodesRemaining: z.int().min(0).nullable(),
})
export type MfaVerifyResponse = z.infer<typeof MfaVerifyResponse>

/** One second factor of the account. */
export const MfaFactor = z.object({
  id: z.uuid(),
  type: z.literal('totp'),
  name: z.string().nullable(),
  createdAt: isoDate,
  lastUsedAt: isoDate.nullable(),
})
export type MfaFactor = z.infer<typeof MfaFactor>

/** GET /me/mfa. */
export const MfaListResponse = z.object({
  factors: z.array(MfaFactor),
  /** How many recovery codes are still unused. */
  recoveryCodesRemaining: z.int().min(0),
  /** A role of the account requires a second factor (the last one cannot be removed). */
  required: z.boolean(),
})
export type MfaListResponse = z.infer<typeof MfaListResponse>

/** POST /me/mfa/totp: starts enrolment. The name is what the person calls the device («iPhone»). */
export const MfaEnrolStartRequest = z.strictObject({ name: oneLine(100).optional() })
export type MfaEnrolStartRequest = z.infer<typeof MfaEnrolStartRequest>

/**
 * 201 from POST /me/mfa/totp. Shown once, then confirmed with a first code. `secret` is the key as base32 for typing by
 * hand, `uri` the `otpauth://` address, and `qrSvg` the QR code of it as an SVG document (made on the server).
 */
export const MfaEnrolStartResponse = z.object({
  id: z.uuid(),
  secret: z.string(),
  uri: z.string(),
  qrSvg: z.string(),
})
export type MfaEnrolStartResponse = z.infer<typeof MfaEnrolStartResponse>

/**
 * POST /me/mfa/totp/{id}/confirm: the first code from the app, and the account's current password. The password is
 * required in a complete session (adding a factor is a change a stolen session must not be able to make) and is not asked
 * for in a half-signed-in session in state `enrolment`, where the password was given at the login a moment ago. Without it
 * in a complete session the answer is 400 `password_required`.
 */
export const MfaConfirmRequest = z.strictObject({ code: TotpCode, password: LoginPassword.optional() })
export type MfaConfirmRequest = z.infer<typeof MfaConfirmRequest>

/**
 * 200 from the confirmation. `recoveryCodes` is set only when the account had none (its first factor): these are all the
 * codes, shown this once. `loginCompleted` is true when the call finished a half-done login (the role requires a factor
 * and the account had none); the session is then complete, with a new cookie.
 */
export const MfaConfirmResponse = z.object({
  factor: MfaFactor,
  recoveryCodes: z.array(z.string()).nullable(),
  loginCompleted: z.boolean(),
})
export type MfaConfirmResponse = z.infer<typeof MfaConfirmResponse>

/**
 * Proof that it is still the owner at the keyboard, for removing a factor or making new recovery codes: the account's
 * current password. A code from the app is not accepted instead: someone who holds a session and a phone is not the owner.
 */
export const ReauthRequest = z.strictObject({ password: LoginPassword })
export type ReauthRequest = z.infer<typeof ReauthRequest>

/** 200 from POST /me/mfa/recovery-codes: ten new codes, shown once; the old ones no longer work. */
export const RecoveryCodesResponse = z.object({ recoveryCodes: z.array(z.string()) })
export type RecoveryCodesResponse = z.infer<typeof RecoveryCodesResponse>

export const MfaFactorIdParams = z.object({ id: z.uuid() })
export type MfaFactorIdParams = z.infer<typeof MfaFactorIdParams>

// ── Password and e-mail of the signed-in account (K-012, K-013) ─

/** PATCH /me/password. */
export const ChangePasswordRequest = z.strictObject({ currentPassword: LoginPassword, newPassword: NewPassword })
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>

/** POST /me/email-change. Always answers 202, whether or not the address is free. */
export const EmailChangeRequest = z.strictObject({ newEmail: Email, password: LoginPassword })
export type EmailChangeRequest = z.infer<typeof EmailChangeRequest>

/** POST /me/email-change/confirm: the token of the link sent to the new address. */
export const EmailChangeConfirmRequest = z.strictObject({ token: OneTimeToken })
export type EmailChangeConfirmRequest = z.infer<typeof EmailChangeConfirmRequest>

export const EmailChangeConfirmResponse = z.object({ email: z.string() })
export type EmailChangeConfirmResponse = z.infer<typeof EmailChangeConfirmResponse>
