import { PASSWORD, createUser, hasMail, linkIn, resetLimits, uniqueName, waitForMail } from './helpers/stack.ts'
import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { fillLogin } from './helpers/screens.ts'

test.beforeEach(async () => {
  await resetLimits()
})

const NEW_PASSWORD = 'a different long password 99'

test('lost password through the mail: link, new password, login', async ({ page }) => {
  const user = await createUser('editor', 'lost')

  // From the login screen's own link.
  await page.goto('/admin/login')
  await page.getByRole('link', { name: 'Mistet passordet?' }).click()
  await expect(page).toHaveURL(/action=lostpassword/)
  await expect(page.getByRole('heading', { level: 1, name: 'Mistet passordet?' })).toBeVisible()
  await expectNoAxeViolations(page, 'lost password')

  await page.getByLabel('Brukernavn eller e-postadresse').fill(user.email)
  await page.getByRole('button', { name: 'Få lenke for nytt passord' }).click()
  await expect(page).toHaveURL(/\/admin\/login\?checkemail=confirm$/)
  const notice = page.getByRole('status').filter({ hasText: 'Sjekk e-posten din.' })
  await expect(notice).toBeVisible()
  await expectNoAxeViolations(page, 'login with the check-your-mail notice')

  const link = linkIn(await waitForMail(user.email, /passord/i), 'resetpass')
  await page.goto(link)

  // The token is read from the fragment and taken out of the address bar at once.
  await expect(page.getByRole('heading', { level: 1, name: 'Nytt passord' })).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/login\?action=resetpass$/)
  expect(await page.evaluate(() => window.location.hash)).toBe('')

  // Too short: caught in the form.
  await page.getByLabel('Nytt passord').fill('short')
  await page.getByRole('button', { name: 'Lagre passord' }).click()
  await expect(page.getByText('Passordet må ha minst 8 tegn.')).toBeVisible()
  await expect(page.getByLabel('Nytt passord')).toBeFocused()

  // The generator fills the field with a strong password and shows it.
  await page.getByRole('button', { name: 'Generer passord' }).click()
  const field = page.getByLabel('Nytt passord')
  await expect(field).toHaveAttribute('type', 'text')
  expect((await field.inputValue()).length).toBe(24)
  await expect(page.getByText('Passordstyrke: svært sterkt')).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Et nytt passord er satt inn' })).toBeVisible()
  await expectNoAxeViolations(page, 'new password with the generated password')

  // A password of our own, hidden again.
  await field.fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'Skjul passord' }).click()
  await expect(field).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Lagre passord' }).click()

  await expect(page).toHaveURL(/\/admin\/login\?password=changed$/)
  await expect(page.getByRole('status').filter({ hasText: 'Passordet er endret.' })).toBeVisible()
  await expectNoAxeViolations(page, 'login after the password was changed')

  // The new password works; the old one no longer does.
  await fillLogin(page, { username: user.username, password: NEW_PASSWORD })
  await expect(page.getByText(`Logget inn som ${user.username}.`)).toBeVisible()
})

test('the link works once', async ({ page, allowFailedRequests }) => {
  allowFailedRequests()
  const user = await createUser('editor', 'once')
  await page.goto('/admin/login?action=lostpassword')
  await page.getByLabel('Brukernavn eller e-postadresse').fill(user.username)
  await page.getByRole('button', { name: 'Få lenke for nytt passord' }).click()
  const link = linkIn(await waitForMail(user.email, /passord/i), 'resetpass')

  await page.goto(link)
  await page.getByLabel('Nytt passord').fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'Lagre passord' }).click()
  await expect(page).toHaveURL(/password=changed/)

  await page.goto(link)
  await page.getByLabel('Nytt passord').fill('yet another long password 5')
  await page.getByRole('button', { name: 'Lagre passord' }).click()
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Lenken er ugyldig, utløpt eller allerede brukt.')
  await expect(page.getByRole('link', { name: 'Be om en ny lenke' })).toBeVisible()
  await expectNoAxeViolations(page, 'new password with a used link')
})

test('a link without a token says so and offers a new one', async ({ page }) => {
  await page.goto('/admin/login?action=resetpass')
  await expect(page.getByRole('alert')).toContainText('Lenken er ugyldig')
  await page.getByRole('link', { name: 'Be om en ny lenke' }).click()
  await expect(page).toHaveURL(/action=lostpassword/)
  await page.goto('/admin/login?action=setpassword#token=not-a-token')
  await expect(page.getByRole('alert')).toContainText('Lenken er ugyldig')
  expect(await page.evaluate(() => window.location.hash)).toBe('')
  await expectNoAxeViolations(page, 'new password without a token')
})

test('gives the same answer for an account that does not exist, and sends no mail', async ({ page }) => {
  const nobody = uniqueName('nobody')
  await page.goto('/admin/login?action=lostpassword')
  await page.getByLabel('Brukernavn eller e-postadresse').fill(`${nobody}@example.test`)
  await page.getByRole('button', { name: 'Få lenke for nytt passord' }).click()
  await expect(page).toHaveURL(/\/admin\/login\?checkemail=confirm$/)
  await expect(page.getByRole('status').filter({ hasText: 'Sjekk e-posten din.' })).toBeVisible()
  await page.waitForTimeout(3000)
  expect(await hasMail(`${nobody}@example.test`)).toBe(false)
})

test('the old password stops working once the new one is set', async ({ page, allowFailedRequests }) => {
  allowFailedRequests()
  const user = await createUser('editor', 'oldpw')
  await page.goto('/admin/login?action=lostpassword')
  await page.getByLabel('Brukernavn eller e-postadresse').fill(user.username)
  await page.getByRole('button', { name: 'Få lenke for nytt passord' }).click()
  await page.goto(linkIn(await waitForMail(user.email, /passord/i), 'resetpass'))
  await page.getByLabel('Nytt passord').fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'Lagre passord' }).click()
  await expect(page).toHaveURL(/password=changed/)
  await fillLogin(page, { username: user.username, password: PASSWORD })
  await expect(page.getByRole('alert')).toContainText('er feil')
})
