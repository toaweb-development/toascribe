import type { Page } from '@playwright/test'

import { createUser, resetLimits, setSetting } from './helpers/stack.ts'
import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { signIn, waitForSessionCookie } from './helpers/screens.ts'

// K-001: the sign-in screens show the site's name from the settings (`blogname`), and the product's own name only when the
// setting is empty. The name is read by the server while it renders, so it is in the first HTML and nothing changes when the
// browser takes over.

// A name with characters that must be escaped, and a space at each end that the API trims.
const SITE_NAME = 'Kaffekroken & co <b>'
const SHOWN = 'Kaffekroken & co <b>'

test.beforeEach(async () => {
  await resetLimits()
})

test.afterEach(async () => {
  await setSetting('blogname', '')
  await setSetting('users_can_register', false)
})

test('the name is in the first HTML, escaped, and the link back to the site uses it', async ({ request }) => {
  await setSetting('blogname', `  ${SITE_NAME}  `)
  const html = await (await request.get('/admin/login')).text()
  expect(html).toContain('Kaffekroken &amp; co &lt;b&gt;')
  expect(html).not.toContain('<b>')
  expect(html).toContain('← Gå til Kaffekroken &amp; co &lt;b&gt;')
})

test('the login, register, lost-password and logout screens show it, and the link goes to the site', async ({
  page,
  context,
}) => {
  await setSetting('blogname', SITE_NAME)
  await setSetting('users_can_register', true)
  const user = await createUser('editor', 'sitename')

  await page.goto('/admin/login')
  await expect(page.getByRole('link', { name: SHOWN, exact: true })).toBeVisible()
  const back = page.getByRole('link', { name: `← Gå til ${SHOWN}` })
  await expect(back).toHaveAttribute('href', '/')
  await expect(page.getByText('toascribe', { exact: true })).toHaveCount(0)
  await expectNoAxeViolations(page, 'login with a site name')

  await page.goto('/admin/login?action=lostpassword')
  await expect(page.getByRole('link', { name: SHOWN, exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: `← Gå til ${SHOWN}` })).toBeVisible()

  await page.goto('/admin/register')
  await expect(page.getByRole('heading', { level: 1, name: 'Registrer' })).toBeVisible()
  await expect(page.getByRole('link', { name: SHOWN, exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: `← Gå til ${SHOWN}` })).toBeVisible()

  // A client-side move between the screens keeps the name without asking again.
  await page.goto('/admin/login')
  await page.getByRole('link', { name: 'Mistet passordet?' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Mistet passordet?' })).toBeVisible()
  await expect(page.getByRole('link', { name: SHOWN, exact: true })).toBeVisible()

  await signIn(page, user)
  await waitForSessionCookie(context)
  await page.goto('/admin/logout')
  await expect(page.getByText(`Du forsøker å logge ut av ${SHOWN}. Vil du logge ut?`)).toBeVisible()
  await expect(page.getByRole('link', { name: SHOWN, exact: true })).toBeVisible()
  await expectNoAxeViolations(page, 'logout with a site name')
})

test('an empty setting falls back to the product name, on every screen', async ({ page }) => {
  await setSetting('blogname', '')
  await setSetting('users_can_register', true)
  for (const path of ['/admin/login', '/admin/register', '/admin/login?action=lostpassword']) {
    await page.goto(path)
    await expect(page.getByRole('link', { name: 'toascribe', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: '← Gå til toascribe' })).toBeVisible()
  }
})

test('the name does not move when the browser takes over from the server-rendered page', async ({
  page,
  browser,
  baseURL,
}) => {
  await setSetting('blogname', SITE_NAME)
  const link = (target: Page) => target.getByRole('link', { name: SHOWN, exact: true })
  // Without script the page is exactly what the server sent.
  const plain = await browser.newContext({ baseURL, javaScriptEnabled: false, viewport: page.viewportSize() })
  const server = await plain.newPage()
  await server.goto('/admin/login')
  await expect(link(server)).toBeVisible()
  const before = await link(server).boundingBox()
  await plain.close()

  await page.goto('/admin/login')
  await expect(page.getByLabel('Brukernavn eller e-postadresse')).toBeVisible()
  expect(await link(page).boundingBox()).toEqual(before)
})
