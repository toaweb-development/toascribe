import type { Page } from '@playwright/test'

import { createUser, linkIn, resetLimits, uniqueName, waitForMail } from './helpers/stack.ts'
import type { TestUser } from './helpers/stack.ts'
import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { fillLogin, signIn } from './helpers/screens.ts'

test.beforeEach(async () => {
  await resetLimits()
})

/** Asks for an e-mail change through the api, as the profile screen will (M0.5): the link goes to the new address. */
async function askForNewAddress(page: Page, user: TestUser): Promise<string> {
  const origin = new URL(page.url()).origin
  const session = (await (await page.request.get('/api/v1/auth/session')).json()) as { csrfToken: string }
  const newEmail = `${uniqueName('new')}@example.test`
  const response = await page.request.post('/api/v1/me/email-change', {
    headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken },
    data: { newEmail, password: user.password },
  })
  expect(response.status()).toBe(202)
  return newEmail
}

test('the link confirms the new address when the person is signed in', async ({ page }) => {
  const user = await createUser('editor', 'chg')
  await signIn(page, user)
  const newEmail = await askForNewAddress(page, user)
  const link = linkIn(await waitForMail(newEmail), 'confirmemail')

  await page.goto(link)
  await expect(page.getByRole('heading', { level: 1, name: 'Bekreft e-postadressen' })).toBeVisible()
  await expect(page.getByText(`E-postadressen er bekreftet. Kontoen bruker nå ${newEmail}.`)).toBeVisible()
  expect(await page.evaluate(() => window.location.hash)).toBe('')
  await expectNoAxeViolations(page, 'confirm e-mail (done)')
})

test('without a session the person logs in first and comes back to the link', async ({ page, context }) => {
  const user = await createUser('editor', 'chg')
  await signIn(page, user)
  const newEmail = await askForNewAddress(page, user)
  const link = linkIn(await waitForMail(newEmail), 'confirmemail')

  // Signed out (the cookie is dropped here: the link is opened in a browser that has no session).
  await context.clearCookies()
  await page.goto(link)
  await expect(page).toHaveURL(/\/admin\/login\?redirectTo=.*#token=/)
  await expect(page.getByRole('heading', { level: 1, name: 'Logg inn' })).toBeVisible()
  await expectNoAxeViolations(page, 'login on the way to the confirm link')

  await fillLogin(page, user)
  await expect(page.getByText(`E-postadressen er bekreftet. Kontoen bruker nå ${newEmail}.`)).toBeVisible()
  expect(await page.evaluate(() => window.location.hash)).toBe('')
})

test('another account cannot confirm the address', async ({ page, context, allowFailedRequests }) => {
  allowFailedRequests()
  const owner = await createUser('editor', 'own')
  const other = await createUser('editor', 'oth')
  await signIn(page, owner)
  const newEmail = await askForNewAddress(page, owner)
  const link = linkIn(await waitForMail(newEmail), 'confirmemail')

  await context.clearCookies()
  await signIn(page, other)
  await page.goto(link)
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByText('E-postadressen er bekreftet')).toHaveCount(0)
  await expectNoAxeViolations(page, 'confirm e-mail (refused)')
})
