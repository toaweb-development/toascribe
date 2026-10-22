import { expect } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import * as OTPAuth from 'otpauth'

import type { TestUser } from './stack.ts'

// The things the tests do on the sign-in screens, by what a person sees (labels and roles), never by CSS.

export async function fillLogin(
  page: Page,
  user: Pick<TestUser, 'username' | 'password'>,
  remember = false,
): Promise<void> {
  await page.getByLabel('Brukernavn eller e-postadresse').fill(user.username)
  await page.getByLabel('Passord', { exact: true }).fill(user.password)
  if (remember) {
    await page.getByLabel('Husk meg').check()
  }
  await page.getByRole('button', { name: 'Logg inn' }).click()
}

/**
 * Waits until the browser's cookie jar has the session cookie. Chromium commits a cookie from a response a few
 * milliseconds after the page has moved on, so a `goto` right after a login can go out without it.
 */
export async function waitForSessionCookie(context: BrowserContext): Promise<void> {
  await expect
    .poll(async () => (await context.cookies()).some((cookie) => cookie.name === '__Host-toa_session'))
    .toBe(true)
}

/** Opens the login screen, signs in and waits for the admin index. */
export async function signIn(
  page: Page,
  user: Pick<TestUser, 'username' | 'password'>,
  address = '/admin/login',
): Promise<void> {
  await page.goto(address)
  await fillLogin(page, user)
  await expect(page.getByText(`Logget inn som ${user.username}.`)).toBeVisible()
}

/** The six digits for `secret` (base32) at a moment: the api accepts the step before, this one and the next. */
export function totpCode(secret: string, atMs: number = Date.now()): string {
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret.replaceAll(' ', '')),
    digits: 6,
    period: 30,
    algorithm: 'SHA1',
  })
  return totp.generate({ timestamp: atMs })
}

/** One period ahead: the api keeps the last step it accepted, so a second code in the same step is refused as a replay. */
export const NEXT_STEP_MS = 30_000

/** Goes through the logout page and waits for the login screen's «du er logget ut». */
export async function signOut(page: Page): Promise<void> {
  await page.goto('/admin/logout')
  await page.getByRole('button', { name: 'Logg ut' }).click()
  await expect(page).toHaveURL(/\/admin\/login\?loggedout=true$/)
}
