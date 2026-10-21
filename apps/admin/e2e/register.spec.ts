import { createUser, linkIn, resetLimits, setSetting, uniqueName, waitForMail } from './helpers/stack.ts'
import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { fillLogin } from './helpers/screens.ts'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async () => {
  await resetLimits()
})

test.afterAll(async () => {
  await setSetting('users_can_register', false)
})

test('registration is closed by default: a message, and no link on the login screen', async ({ page }) => {
  await setSetting('users_can_register', false)
  await page.goto('/admin/login')
  await expect(page.getByRole('link', { name: 'Registrer' })).toHaveCount(0)

  await page.goto('/admin/register')
  await expect(page.getByRole('heading', { level: 1, name: 'Registrering er slått av' })).toBeVisible()
  await expect(page.getByLabel('Brukernavn')).toHaveCount(0)
  await expectNoAxeViolations(page, 'register (closed)')
})

test('registration open: form, generic confirmation, set a password from the welcome link, log in', async ({
  page,
}) => {
  await setSetting('users_can_register', true)
  const username = uniqueName('reg')
  const email = `${username}@example.test`

  await page.goto('/admin/login')
  await page.getByRole('link', { name: 'Registrer' }).click()
  await expect(page).toHaveURL(/\/admin\/register$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Registrer' })).toBeVisible()
  await expectNoAxeViolations(page, 'register')

  // Caught in the form.
  await page.getByLabel('Brukernavn').fill('ab')
  await page.getByLabel('E-postadresse').fill('not an address')
  await page.getByRole('button', { name: 'Registrer' }).click()
  await expect(page.getByText('Brukernavnet må ha 3 til 60 tegn')).toBeVisible()
  await expect(page.getByText('Skriv inn en gyldig e-postadresse')).toBeVisible()
  await expect(page.getByLabel('Brukernavn')).toBeFocused()
  await expectNoAxeViolations(page, 'register with field errors')

  await page.getByLabel('Brukernavn').fill(username)
  await page.getByLabel('E-postadresse').fill(email)
  await page.getByRole('button', { name: 'Registrer' }).click()
  await expect(page).toHaveURL(/\/admin\/login\?checkemail=registered$/)
  await expect(page.getByRole('status').filter({ hasText: 'Registreringen er mottatt.' })).toBeVisible()
  await expectNoAxeViolations(page, 'login with the registered notice')

  // The welcome link sets the first password.
  const link = linkIn(await waitForMail(email), 'setpassword')
  await page.goto(link)
  await expect(page.getByRole('heading', { level: 1, name: 'Velg passord' })).toBeVisible()
  await expect(page).toHaveURL(/action=setpassword$/)
  await expectNoAxeViolations(page, 'set password')
  await page.getByLabel('Nytt passord').fill('my first long password 1')
  await page.getByRole('button', { name: 'Lagre passord' }).click()
  await expect(page).toHaveURL(/password=changed/)

  await fillLogin(page, { username, password: 'my first long password 1' })
  await expect(page.getByText(`Logget inn som ${username}.`)).toBeVisible()
})

test('an address that already has an account gets the same confirmation', async ({ page }) => {
  await setSetting('users_can_register', true)
  const existing = await createUser('editor', 'taken')
  await page.goto('/admin/register')
  await page.getByLabel('Brukernavn').fill(uniqueName('other'))
  await page.getByLabel('E-postadresse').fill(existing.email)
  await page.getByRole('button', { name: 'Registrer' }).click()
  await expect(page).toHaveURL(/\/admin\/login\?checkemail=registered$/)
  await expect(page.getByRole('status')).toContainText('Registreringen er mottatt.')
})
