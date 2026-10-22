import { compose, createUser, resetLimits, setSetting, uniqueName } from './helpers/stack.ts'
import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { fillLogin } from './helpers/screens.ts'

// K-026, with no hard lock (fix round 2): too many wrong tries make the next one wait, and the wait grows and shrinks by
// itself. The API answers 429 with `Retry-After` in seconds, and the screen says how long.

test.afterEach(async () => {
  await resetLimits()
})

const WAIT_IN_SECONDS = /For mange forsøk\. Prøv igjen om (\d+) sekunder?\./

async function wrongPasswords(
  request: import('@playwright/test').APIRequestContext,
  login: (attempt: number) => string,
  count: number,
): Promise<void> {
  const origin = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:18080').origin
  for (let attempt = 0; attempt < count; attempt += 1) {
    await request.post('/api/v1/auth/login', {
      headers: { Origin: origin },
      data: { login: login(attempt), password: 'wrong', remember: false },
    })
  }
}

test('too many wrong passwords from one address: the next try has to wait, the message says how long, and the form stays', async ({
  page,
  request,
  allowFailedRequests,
}) => {
  allowFailedRequests()
  await resetLimits()
  // 20 failures from one address are free (the login_limit_ip_attempts setting); then each try waits, 30 seconds first.
  await wrongPasswords(request, (attempt) => `nobody${attempt}`, 22)
  const user = await createUser('editor', 'waiting')
  await page.goto('/admin/login')
  await fillLogin(page, user)
  const alert = page.getByRole('alert')
  await expect(alert).toContainText(WAIT_IN_SECONDS)
  await expect(alert).toBeFocused()
  await expect(page.getByLabel('Brukernavn eller e-postadresse')).toHaveValue(user.username)
  await expectNoAxeViolations(page, 'login while waiting')
})

test('too many wrong passwords for one name: the right password waits too, for a known and an unknown name alike', async ({
  page,
  request,
  allowFailedRequests,
}) => {
  allowFailedRequests()
  await resetLimits()
  const user = await createUser('editor', 'perName')
  // 5 failures per name are free (login_limit_account_attempts); the 6th try has to wait 30 seconds.
  await wrongPasswords(request, () => user.username, 5)
  await wrongPasswords(request, () => 'noSuchPerson', 5)

  await page.goto('/admin/login')
  await fillLogin(page, user)
  await expect(page.getByRole('alert')).toContainText(WAIT_IN_SECONDS)
  await page.getByLabel('Brukernavn eller e-postadresse').fill('noSuchPerson')
  await page.getByRole('button', { name: 'Logg inn' }).click()
  await expect(page.getByRole('alert')).toContainText(WAIT_IN_SECONDS)

  // The name's wait is over after a reset (what `toa user reset-login-limit` does), and the right password works again.
  await compose(['exec', '-T', 'api', 'toa', 'user', 'reset-login-limit', '--username', user.username])
  await page.getByLabel('Brukernavn eller e-postadresse').fill(user.username)
  await page.getByLabel('Passord', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Logg inn' }).click()
  await expect(page).toHaveURL(/\/admin\/?$/)
})

test('the wait is shown on the lost-password screen too, for a name that matches no account', async ({
  page,
  request,
  allowFailedRequests,
}) => {
  allowFailedRequests()
  await resetLimits()
  const origin = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:18080').origin
  // Every request for a link counts as a try for its name (login_limit_account_attempts, 5): the 6th has to wait.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await request.post('/api/v1/auth/password/lost', {
      headers: { Origin: origin },
      data: { login: 'noSuchPerson' },
    })
    expect(response.status()).toBe(202)
  }
  await page.goto('/admin/login?action=lostpassword')
  await page.getByLabel('Brukernavn eller e-postadresse').fill('noSuchPerson')
  await page.getByRole('button', { name: 'Få lenke for nytt passord' }).click()
  await expect(page.getByRole('alert')).toContainText(WAIT_IN_SECONDS)
  await expectNoAxeViolations(page, 'lost password while waiting')
})

test('the wait is shown on the register screen too, keyed on the address that was typed', async ({
  page,
  request,
  allowFailedRequests,
}) => {
  allowFailedRequests()
  await resetLimits()
  await setSetting('users_can_register', true)
  try {
    const origin = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:18080').origin
    const email = `${uniqueName('waitreg')}@example.test`
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request.post('/api/v1/auth/register', {
        headers: { Origin: origin },
        data: { username: uniqueName('w'), email },
      })
      expect(response.status()).toBe(202)
    }
    await page.goto('/admin/register')
    await page.getByLabel('Brukernavn').fill(uniqueName('w'))
    await page.getByLabel('E-postadresse').fill(email)
    await page.getByRole('button', { name: 'Registrer' }).click()
    await expect(page.getByRole('alert')).toContainText(WAIT_IN_SECONDS)
    await expectNoAxeViolations(page, 'register while waiting')
  } finally {
    await setSetting('users_can_register', false)
  }
})
