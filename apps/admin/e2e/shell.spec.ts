import type { Page } from '@playwright/test'

import { createUser, raiseNotice, removeNotice, resetLimits, resetPreferences } from './helpers/stack.ts'
import type { TestUser } from './helpers/stack.ts'
import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { expectSignedIn, signIn } from './helpers/screens.ts'

// The admin shell (M0.5): the menu from the api, the bar across the top, the colour scheme and the dashboard. Each test runs at 375 px
// and at 1280 px; the fixture fails a test on any console message or CSP violation.

const DISMISSIBLE_NOTICE = 'e2e.dismissible'

// Every new account is announced to the administrators by mail, so one administrator is made for the file and not one for each test
// (the queue would fill with mail the other specs wait behind). Its preferences start over before each test.
let admin: TestUser

test.beforeAll(async () => {
  admin = await createUser('administrator', 'shelladmin')
})

test.beforeEach(async () => {
  await resetLimits()
  await resetPreferences(admin.username)
})

/** Below `lg` the sidebar is an overlay behind a button; from `lg` it is there. Returns the menu either way. */
async function menuOf(page: Page) {
  const menu = page.getByRole('navigation', { name: 'Hovedmeny' })
  if (!(await menu.isVisible())) {
    await page.getByRole('button', { name: 'Åpne sidepanel' }).click()
  }
  await expect(menu).toBeVisible()
  return menu
}

/** Sets preferences as the signed-in account would (the profile page does the same call). */
async function savePreferences(page: Page, changes: Record<string, unknown>): Promise<void> {
  const session = (await (await page.request.get('/api/v1/auth/session')).json()) as { csrfToken: string }
  const origin = new URL(page.url()).origin
  const answer = await page.request.patch('/api/v1/me/preferences', {
    data: changes,
    headers: { 'X-CSRF-Token': session.csrfToken, origin },
  })
  expect(answer.ok(), await answer.text()).toBe(true)
}

test('an administrator sees Kontrollpanel and Brukere with Alle brukere and Profil', async ({ page }) => {
  const user = admin
  await signIn(page, user)
  await expect(page.getByRole('heading', { level: 1, name: 'Kontrollpanel' })).toBeVisible()
  await expectSignedIn(page, user)

  const menu = await menuOf(page)
  await expect(menu.getByRole('link', { name: 'Kontrollpanel' })).toBeVisible()
  // The current section is open, with «Hjem»; the page is marked as the current one.
  await expect(menu.getByRole('link', { name: 'Hjem' })).toHaveAttribute('aria-current', 'page')
  await expect(menu.getByRole('link', { name: 'Brukere', exact: true })).toBeVisible()
  await expect(menu.getByRole('link', { name: 'Alle brukere' })).toBeVisible()
  await expect(menu.getByRole('link', { name: 'Profil' })).toBeVisible()
  await expectNoAxeViolations(page, 'the dashboard with the menu open')
})

test('a subscriber sees Kontrollpanel and Profil only', async ({ page }) => {
  const user = await createUser('subscriber', 'shellsub')
  await signIn(page, user)
  await expect(page.getByRole('heading', { level: 1, name: 'Kontrollpanel' })).toBeVisible()

  const menu = await menuOf(page)
  await expect(menu.getByRole('link', { name: 'Kontrollpanel' })).toBeVisible()
  await expect(menu.getByRole('link', { name: 'Profil' })).toBeVisible()
  await expect(menu.getByRole('link', { name: 'Brukere', exact: true })).toHaveCount(0)

  // Only what the account may see: no counts of posts, pages or comments (not zeros), no notices, and no link to the users.
  await page.keyboard.press('Escape')
  await expect(page.getByText('toascribe 0.', { exact: false })).toBeVisible()
  await expect(page.getByText(/innlegg|sider?\b|kommentar|venter på godkjenning/)).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Se alle brukere' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Rediger profilen din' })).toBeVisible()
})

test('an anonymous visitor goes to the login screen and is brought back after signing in', async ({ page }) => {
  const user = await createUser('editor', 'shellanon')
  await page.goto('/admin/')
  await expect(page).toHaveURL(/\/admin\/login/)
  await expect(page.getByRole('heading', { level: 1, name: 'Logg inn' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Hovedmeny' })).toHaveCount(0)

  await page.getByLabel('Brukernavn eller e-postadresse').fill(user.username)
  await page.getByLabel('Passord', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Logg inn' }).click()
  await expect(page).toHaveURL(/\/admin\/?$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Kontrollpanel' })).toBeVisible()
  await expectSignedIn(page, user)
})

test('the bar leads to the site and holds the account menu', async ({ page }) => {
  const user = await createUser('editor', 'shellbar')
  await signIn(page, user)
  await expect(page.getByRole('link', { name: /Besøk nettstedet/ })).toHaveAttribute('href', '/')

  await page.getByRole('button', { name: `Hei, ${user.username}` }).click()
  await expect(page.getByRole('menuitem', { name: 'Rediger profil' })).toHaveAttribute('href', '/admin/profile')
  await page.getByRole('menuitem', { name: 'Logg ut' }).click()
  await expect(page).toHaveURL(/\/admin\/logout$/)
  await expect(page.getByText('Du forsøker å logge ut av')).toBeVisible()
})

test.describe('the dashboard', () => {
  test.beforeEach(async () => {
    await raiseNotice(DISMISSIBLE_NOTICE, 'notices.setupEmailSkipped')
  })
  test.afterEach(async () => {
    await removeNotice(DISMISSIBLE_NOTICE)
  })

  test('shows the counts, the e-mail notice and the welcome panel', async ({ page }) => {
    const user = admin
    await signIn(page, user)

    const glance = page.getByRole('region', { name: 'I korte trekk' })
    // Other specs publish posts and pages in the same database (M1.1), so the counts are read as numbers, and they link to the lists.
    await expect(glance.getByRole('link', { name: /^\d+ innlegg$/ })).toHaveAttribute(
      'href',
      '/admin/posts?status=publish',
    )
    await expect(glance.getByRole('link', { name: /^\d+ sider?$/ })).toHaveAttribute(
      'href',
      '/admin/pages?status=publish',
    )
    await expect(glance.getByText('1 kommentar', { exact: true })).toBeVisible()
    await expect(glance.getByText('0 venter på godkjenning')).toBeVisible()
    await expect(glance.getByText(/^toascribe \d+\.\d+\.\d+/)).toBeVisible()

    // The site was installed with --skip-email: its e-mail has not been tested, and that notice cannot be dismissed.
    const notices = page.getByRole('region', { name: 'Varsler' })
    const email = notices.getByRole('listitem').filter({ hasText: 'E-post fra nettstedet er ikke testet' })
    await expect(email).toBeVisible()
    await expect(email.getByRole('button', { name: 'Avvis' })).toHaveCount(0)
    await expectNoAxeViolations(page, 'the dashboard with notices')
  })

  test('keeps a dismissed notice away after a reload', async ({ page }) => {
    const user = admin
    await signIn(page, user)

    const notices = page.getByRole('region', { name: 'Varsler' })
    const mine = notices.getByRole('listitem').filter({ hasText: 'Du hoppet over e-postoppsettet' })
    await expect(mine).toBeVisible()
    await mine.getByRole('button', { name: 'Avvis' }).click()
    await expect(mine).toHaveCount(0)

    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Kontrollpanel' })).toBeVisible()
    await expect(
      notices.getByRole('listitem').filter({ hasText: 'E-post fra nettstedet er ikke testet' }),
    ).toBeVisible()
    await expect(page.getByText('Du hoppet over e-postoppsettet')).toHaveCount(0)
  })

  test('keeps a dismissed welcome panel away after a reload', async ({ page }) => {
    const user = admin
    await signIn(page, user)

    const welcome = page.getByRole('region', { name: 'Velkommen til toascribe!' })
    await expect(welcome.getByRole('link', { name: 'Rediger profilen din' })).toBeVisible()
    await expect(welcome.getByRole('link', { name: 'Se alle brukere' })).toBeVisible()
    await welcome.getByRole('button', { name: 'Avvis' }).click()
    await expect(welcome).toHaveCount(0)

    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Kontrollpanel' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'I korte trekk' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Velkommen til toascribe!' })).toHaveCount(0)
  })
})

test.describe('the colour scheme', () => {
  // The system is light, so any dark page here comes from the account's scheme and not from the system.
  test.use({ colorScheme: 'light' })

  test('follows the account: midnight is dark, light is light, ocean has another primary', async ({ page }) => {
    const user = admin
    await signIn(page, user)
    const html = page.locator('html')
    await expect(html).not.toHaveClass(/dark/)

    await savePreferences(page, { adminColorScheme: 'midnight' })
    await page.reload()
    await expect(html).toHaveClass(/dark/)
    await expect(page.getByRole('heading', { level: 1, name: 'Kontrollpanel' })).toBeVisible()
    expect(await page.locator('#nuxt-ui-colors').textContent()).toContain('indigo')
    await expectNoAxeViolations(page, 'the dashboard, midnight')

    await savePreferences(page, { adminColorScheme: 'ocean' })
    await page.reload()
    await expect(html).not.toHaveClass(/dark/)
    expect(await page.locator('#nuxt-ui-colors').textContent()).toContain('sky')
    await expectNoAxeViolations(page, 'the dashboard, ocean')

    await savePreferences(page, { adminColorScheme: 'default' })
    await page.reload()
    await expect(html).not.toHaveClass(/dark/)
    expect(await page.locator('#nuxt-ui-colors').textContent()).not.toContain('sky')
  })

  test('is not dressed on the sign-in screens after the shell is left', async ({ page }) => {
    const user = admin
    await signIn(page, user)
    await savePreferences(page, { adminColorScheme: 'midnight' })
    await page.reload()
    await expect(page.locator('html')).toHaveClass(/dark/)

    await page.getByRole('button', { name: `Hei, ${user.username}` }).click()
    await page.getByRole('menuitem', { name: 'Logg ut' }).click()
    await expect(page).toHaveURL(/\/admin\/logout$/)
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    await savePreferences(page, { adminColorScheme: 'default' })
  })
})
