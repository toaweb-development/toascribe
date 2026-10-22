import type { APIRequestContext, Page } from '@playwright/test'

import { createUser, resetLimits, setSetting } from './helpers/stack.ts'
import type { TestUser } from './helpers/stack.ts'
import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { NEXT_STEP_MS, fillLogin, signOut, totpCode } from './helpers/screens.ts'

test.describe.configure({ mode: 'serial' })

// The role «editor» must use a second factor while these tests run; the accounts they make are editors.
test.beforeAll(async () => {
  await setSetting('mfa_required_roles', ['editor'])
})
test.afterAll(async () => {
  await setSetting('mfa_required_roles', [])
})
test.beforeEach(async () => {
  await resetLimits()
})

interface Enrolled {
  secret: string
  codes: string[]
}

/** Logs in an editor who has no factor yet, sets one up on the screen and ends on the admin index. */
async function enrolThroughScreen(page: Page, user: TestUser, address = '/admin/login'): Promise<Enrolled> {
  await page.goto(address)
  await fillLogin(page, user)
  await expect(page.getByRole('heading', { level: 1, name: 'Sett opp tofaktor' })).toBeVisible()
  const qr = page.getByRole('img', { name: /QR-kode/ })
  await expect(qr).toBeVisible()
  expect(await qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml/)
  await expectNoAxeViolations(page, 'two-factor set-up')
  const secret = (await page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{4})+$/).textContent()) ?? ''
  expect(secret).not.toBe('')

  await page.getByLabel('Kode fra appen').fill(totpCode(secret))
  await page.getByRole('button', { name: 'Bekreft og fullfør' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Gjenopprettingskoder' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Gjenopprettingskoder' })).toBeFocused()
  const items = page.getByRole('list', { name: 'Gjenopprettingskoder' }).getByRole('listitem')
  await expect(items).toHaveCount(10)
  const codes = (await items.allTextContents()).map((code) => code.trim())
  return { secret, codes }
}

/** Signs in and passes the second step through the API, with a recovery code: used to run the codes down. */
async function useRecoveryCode(request: APIRequestContext, user: TestUser, code: string): Promise<void> {
  const origin = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:18080').origin
  const login = await request.post('/api/v1/auth/login', {
    headers: { Origin: origin },
    data: { login: user.username, password: user.password, remember: false },
  })
  expect(login.ok()).toBe(true)
  const { csrfToken } = (await login.json()) as { csrfToken: string }
  const verify = await request.post('/api/v1/auth/mfa/verify', {
    headers: { Origin: origin, 'X-CSRF-Token': csrfToken },
    data: { type: 'recovery', code },
  })
  expect(verify.ok()).toBe(true)
}

test('set up on the screen, keep the recovery codes, then log in with a code from the app', async ({
  page,
  allowFailedRequests,
}) => {
  allowFailedRequests()
  const user = await createUser('editor', 'mfa')
  const { secret } = await enrolThroughScreen(page, user)
  await expectNoAxeViolations(page, 'recovery codes')

  // «Fortsett» is not available until the person says the codes are saved; it explains why and stays put.
  const proceed = page.getByRole('button', { name: 'Fortsett' })
  await expect(proceed).toHaveAttribute('aria-disabled', 'true')
  await expect(proceed).toHaveAccessibleDescription('Bekreft at du har lagret gjenopprettingskodene for å fortsette.')
  // Playwright waits for a button that says aria-disabled; this one is meant to be pressed and to do nothing.
  await proceed.click({ force: true })
  await expect(page.getByRole('heading', { level: 2, name: 'Gjenopprettingskoder' })).toBeVisible()
  await page.getByRole('button', { name: 'Kopier kodene' }).click()
  await expect(page.getByRole('status').filter({ hasText: /Kodene er kopiert|Kunne ikke kopiere/ })).toBeVisible()
  await page.getByLabel('Jeg har lagret kodene').check()
  await proceed.click()
  await expect(page.getByText(`Logget inn som ${user.username}.`)).toBeVisible()

  // Log out and in again: now the code is asked for, and the redirect target is kept through the step.
  await signOut(page)
  await page.goto('/admin/login?redirectTo=%2Fadmin%2Fsetup')
  await fillLogin(page, user)
  const heading = page.getByRole('heading', { level: 1, name: 'Bekreft innloggingen' })
  await expect(heading).toBeVisible()
  // The step replaced the login form under the person's hands: focus is on its heading, not lost.
  await expect(heading).toBeFocused()
  await expectNoAxeViolations(page, 'second step')

  // A reload keeps the step: the session says where the login stands.
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Bekreft innloggingen' })).toBeVisible()

  // The empty field is caught; a wrong code is refused and keeps the step; the right one (the next period, because the last
  // code was used to set up) goes on to the target.
  await page.getByRole('button', { name: 'Bekreft' }).click()
  await expect(page.getByText('Skriv inn koden med seks siffer')).toBeVisible()
  await page.getByLabel('Kode fra appen').fill('000000')
  await page.getByRole('button', { name: 'Bekreft' }).click()
  await expect(page.getByRole('alert')).toContainText('Koden er feil eller har gått ut.')
  await expectNoAxeViolations(page, 'second step with a wrong code')
  await page.getByLabel('Kode fra appen').fill(totpCode(secret, Date.now() + NEXT_STEP_MS))
  await page.getByRole('button', { name: 'Bekreft' }).click()
  await expect(page).toHaveURL(/\/admin\/setup$/)
})

test('a recovery code works instead of the app, and a warning comes when few are left', async ({
  page,
  request,
  allowFailedRequests,
}) => {
  allowFailedRequests()
  const user = await createUser('editor', 'recov')
  const { codes } = await enrolThroughScreen(page, user)
  await page.getByLabel('Jeg har lagret kodene').check()
  await page.getByRole('button', { name: 'Fortsett' }).click()
  await expect(page.getByText(`Logget inn som ${user.username}.`)).toBeVisible()
  await signOut(page)

  // Seven codes are used through the api, so three are left and the eighth is the one that warns.
  for (const code of codes.slice(0, 6)) {
    await useRecoveryCode(request, user, code)
  }

  await page.goto('/admin/login')
  await fillLogin(page, user)
  await page.getByRole('button', { name: 'Bruk en gjenopprettingskode' }).click()
  await expect(page.getByLabel('Gjenopprettingskode')).toBeFocused()
  await expectNoAxeViolations(page, 'second step with a recovery code')
  await page.getByLabel('Gjenopprettingskode').fill('ABCD-EFGH-JKMN-PQRS')
  await page.getByRole('button', { name: 'Bekreft' }).click()
  await expect(page.getByRole('alert')).toContainText('Koden er feil')

  // Lower case and no hyphens are fine.
  const code = codes[6] ?? ''
  await page.getByLabel('Gjenopprettingskode').fill(code.toLowerCase().replaceAll('-', ''))
  await page.getByRole('button', { name: 'Bekreft' }).click()
  // 10 - 6 - 1 = 3 left: the warning comes before the page moves on.
  await expect(page.getByRole('status').filter({ hasText: 'Du har 3 gjenopprettingskoder igjen.' })).toBeVisible()
  await expectNoAxeViolations(page, 'warning about few recovery codes')
  await page.getByRole('button', { name: 'Fortsett' }).click()
  await expect(page.getByText(`Logget inn som ${user.username}.`)).toBeVisible()
})

test('a session that is only half open cannot reach the index and the login screen asks for the code', async ({
  page,
}) => {
  const user = await createUser('editor', 'half')
  await enrolThroughScreen(page, user)
  await page.getByLabel('Jeg har lagret kodene').check()
  await page.getByRole('button', { name: 'Fortsett' }).click()
  await signOut(page)

  await page.goto('/admin/login')
  await fillLogin(page, user)
  await expect(page.getByRole('heading', { level: 1, name: 'Bekreft innloggingen' })).toBeVisible()
  // No «Logget inn som» for a half-open session.
  await page.goto('/admin')
  await expect(page.getByText('Logget inn som')).toHaveCount(0)
  // The login screen shows the step again, with the session the browser still has.
  await page.goto('/admin/login')
  await expect(page.getByRole('heading', { level: 1, name: 'Bekreft innloggingen' })).toBeVisible()
  // The half-open session can be left through the logout page.
  await signOut(page)
})
