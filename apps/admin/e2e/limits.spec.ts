import { createUser, resetLimits } from './helpers/stack.ts'
import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { fillLogin } from './helpers/screens.ts'

test.afterEach(async () => {
  await resetLimits()
})

test('too many wrong passwords from one address: the message says how long to wait, and the form stays', async ({
  page,
  request,
  allowFailedRequests,
}) => {
  allowFailedRequests()
  await resetLimits()
  const origin = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:18080').origin
  // 20 attempts from one address are allowed in 15 minutes (the login_limit_ip_attempts setting); then the address is locked.
  for (let attempt = 0; attempt < 22; attempt += 1) {
    await request.post('/api/v1/auth/login', {
      headers: { Origin: origin },
      data: { login: `nobody${attempt}`, password: 'wrong', remember: false },
    })
  }
  const user = await createUser('editor', 'locked')
  await page.goto('/admin/login')
  await fillLogin(page, user)
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('For mange forsøk. Prøv igjen om 20 minutter.')
  await expect(alert).toBeFocused()
  await expect(page.getByLabel('Brukernavn eller e-postadresse')).toHaveValue(user.username)
  await expectNoAxeViolations(page, 'login while locked')
})
