import { compose, createUser, resetLimits } from './helpers/stack.ts'
import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { expectNotSignedIn, expectSignedIn, fillLogin, signIn, waitForSessionCookie } from './helpers/screens.ts'

test.beforeEach(async () => {
  await resetLimits()
})

test('logs in and out, with a confirmation page before the logout', async ({ page, context }) => {
  const user = await createUser('editor', 'login')

  // The WordPress address goes to the admin (Caddy, 308) and shows the login form.
  await page.goto('/login')
  await expect(page).toHaveURL(/\/admin\/login$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Logg inn' })).toBeVisible()
  await expectNoAxeViolations(page, 'login')

  await fillLogin(page, user)
  await expect(page).toHaveURL(/\/admin\/?$/)
  await expectSignedIn(page, user)

  // The session cookie is `__Host-`, HttpOnly and Secure, and has no expiry (no «Husk meg»).
  const cookie = (await context.cookies()).find((entry) => entry.name === '__Host-toa_session')
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' })
  expect(cookie?.expires).toBe(-1)

  await page.getByRole('button', { name: /^Hei, / }).click()
  await page.getByRole('menuitem', { name: 'Logg ut' }).click()
  await expect(page).toHaveURL(/\/admin\/logout$/)
  await expect(page.getByText('Du forsøker å logge ut av toascribe. Vil du logge ut?')).toBeVisible()
  await expectNoAxeViolations(page, 'logout')
  // A GET alone does not log anyone out: the session is still there.
  await page.goto('/admin')
  await expectSignedIn(page, user)

  await page.goto('/admin/logout')
  await page.getByRole('button', { name: 'Logg ut' }).click()
  await expect(page).toHaveURL(/\/admin\/login\?loggedout=true$/)
  await expect(page.getByRole('status').filter({ hasText: 'Du er nå logget ut.' })).toBeVisible()
  await expectNoAxeViolations(page, 'login after logout')

  await page.goto('/admin')
  await expectNotSignedIn(page)
  expect((await context.cookies()).find((entry) => entry.name === '__Host-toa_session')).toBeUndefined()
})

test('a wrong password gives one message, keeps the username and moves focus to the message', async ({
  page,
  allowFailedRequests,
}) => {
  allowFailedRequests()
  const user = await createUser('editor', 'wrong')
  await page.goto('/admin/login')
  await fillLogin(page, { username: user.username, password: 'not the password' })

  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Brukernavnet, e-postadressen eller passordet er feil.')
  await expect(alert).toBeFocused()
  await expect(page.getByLabel('Brukernavn eller e-postadresse')).toHaveValue(user.username)
  await expectNoAxeViolations(page, 'login with an error')

  // The same message for a name that does not exist (K-004).
  await page.getByLabel('Brukernavn eller e-postadresse').fill('nobody-by-that-name')
  await page.getByRole('button', { name: 'Logg inn' }).click()
  await expect(alert).toContainText('Brukernavnet, e-postadressen eller passordet er feil.')
})

test('empty fields are caught in the form, and focus goes to the first one', async ({ page }) => {
  await page.goto('/admin/login')
  await page.getByRole('button', { name: 'Logg inn' }).click()
  await expect(page.getByText('Skriv inn brukernavnet eller e-postadressen din.')).toBeVisible()
  await expect(page.getByText('Skriv inn passordet.')).toBeVisible()
  await expect(page.getByLabel('Brukernavn eller e-postadresse')).toBeFocused()
  await expectNoAxeViolations(page, 'login with field errors')
})

test('shows and hides the password', async ({ page }) => {
  await page.goto('/admin/login')
  const field = page.getByLabel('Passord', { exact: true })
  await field.fill('secret')
  await expect(field).toHaveAttribute('type', 'password')
  const toggle = page.getByRole('button', { name: 'Vis passord' })
  await toggle.click()
  await expect(field).toHaveAttribute('type', 'text')
  await expect(page.getByRole('button', { name: 'Skjul passord' })).toHaveAttribute('aria-pressed', 'true')
})

test('goes where redirectTo says, and nowhere else', async ({ page, context }) => {
  const user = await createUser('editor', 'redirect')
  await page.goto('/admin/login?redirectTo=%2Fadmin%2Flogout')
  await fillLogin(page, user)
  await expect(page).toHaveURL(/\/admin\/logout$/)
  await waitForSessionCookie(context)

  // Already signed in: the login screen sends the person on at once, and an address on another site is refused.
  await page.goto('/admin/login?redirectTo=https%3A%2F%2Fevil.example%2F')
  await expect(page).toHaveURL(/\/admin\/?$/)
  await page.goto('/admin/login?redirect_to=%2F%2Fevil.example')
  await expect(page).toHaveURL(/\/admin\/?$/)
})

test('«Husk meg» gives a cookie that lasts', async ({ page, context }) => {
  const user = await createUser('editor', 'remember')
  await page.goto('/admin/login')
  await fillLogin(page, user, true)
  await expectSignedIn(page, user)
  const cookie = (await context.cookies()).find((entry) => entry.name === '__Host-toa_session')
  expect(cookie?.expires).toBeGreaterThan(Date.now() / 1000 + 7 * 24 * 3600)
})

test('the WordPress addresses lead to the screens', async ({ page }) => {
  await page.goto('/wp-login.php?action=lostpassword')
  await expect(page).toHaveURL(/\/admin\/login\?action=lostpassword$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Tapt passord' })).toBeVisible()
  await page.goto('/wp-login.php?action=logout')
  // Without a session there is nothing to ask about: the login screen says so.
  await expect(page).toHaveURL(/\/admin\/login\?loggedout=true$/)
  await page.goto('/wp-login.php?action=register')
  await expect(page).toHaveURL(/\/admin\/register$/)
})

test('a logout when the session is already gone still ends at the login screen', async ({
  page,
  allowFailedRequests,
}) => {
  allowFailedRequests()
  const user = await createUser('editor', 'gone')
  await signIn(page, user)
  await page.goto('/admin/logout')
  // The password is reset from the command line, which ends every session of the account.
  await compose(
    ['exec', '-T', 'api', 'toa', 'user', 'reset-password', '--username', user.username, '--password-stdin'],
    'another long password 77',
  )
  await page.getByRole('button', { name: 'Logg ut' }).click()
  await expect(page).toHaveURL(/\/admin\/login\?loggedout=true$/)
})
