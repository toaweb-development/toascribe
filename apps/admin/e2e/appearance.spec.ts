import { createUser, resetLimits } from './helpers/stack.ts'
import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { fillLogin } from './helpers/screens.ts'

// Nuxt UI follows the system's colour scheme. The screens must be legible in both.

test.describe('dark colour scheme', () => {
  test.use({ colorScheme: 'dark' })

  test.beforeEach(async () => {
    await resetLimits()
  })

  test('login, with a message, and the lost-password screen pass axe', async ({ page, allowFailedRequests }) => {
    allowFailedRequests()
    const user = await createUser('editor', 'dark')
    await page.goto('/admin/login')
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expectNoAxeViolations(page, 'login (dark)')
    await fillLogin(page, { username: user.username, password: 'wrong password' })
    await expect(page.getByRole('alert')).toBeVisible()
    await expectNoAxeViolations(page, 'login with an error (dark)')
    await page.goto('/admin/login?checkemail=confirm')
    await expectNoAxeViolations(page, 'login with a notice (dark)')
    await page.goto('/admin/login?action=lostpassword')
    await expectNoAxeViolations(page, 'lost password (dark)')
  })
})
