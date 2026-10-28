import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { signIn } from './helpers/screens.ts'
import { createUser, queryRows } from './helpers/stack.ts'
import type { TestUser } from './helpers/stack.ts'

// M1.8 (K-330): the admin in English. The language follows the profile, then the site's language; another account stays in bokmål.
// At 375 px and 1280 px, with axe and the CSP check of the fixture.

let user: TestUser
let other: TestUser

test.beforeAll(async () => {
  user = await createUser('administrator', 'engelsk')
  other = await createUser('administrator', 'norsk')
})

test('Språk → English switches the admin at once and on every page after; back to the site language', async ({
  page,
}) => {
  await signIn(page, user)
  await page.goto('/admin/profile')
  await page.getByRole('combobox', { name: 'Språk' }).click()
  await page.getByRole('option', { name: 'English' }).click()
  await expect(page.getByText('The language has been saved.')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  expect(await queryRows(`select locale from account where username = '${user.username}'`)).toEqual(['en'])

  // A new page, drawn by the server: in English from the first paint.
  await page.goto('/admin/')
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'At a Glance' })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Help/ })).toBeVisible()
  await expectNoAxeViolations(page, 'the dashboard in English')
  await page.goto('/admin/posts')
  await expect(page.getByRole('heading', { level: 1, name: 'Posts' })).toBeVisible()

  await page.goto('/admin/profile')
  await page.getByRole('combobox', { name: 'Language' }).click()
  await page.getByRole('option', { name: 'Site language' }).click()
  await expect(page.getByText('Språket er lagret.')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'nb')
  expect(await queryRows(`select coalesce(locale, 'null') from account where username = '${user.username}'`)).toEqual([
    'null',
  ])
})

test("the language is the account's own: another account stays in bokmål", async ({ page }) => {
  await signIn(page, other)
  await page.goto('/admin/')
  await expect(page.getByRole('heading', { level: 1, name: 'Kontrollpanel' })).toBeVisible()
})
