import type { Locator, Page } from '@playwright/test'

import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { dashboardHeading, signIn } from './helpers/screens.ts'
import { createUser, resetPreferences } from './helpers/stack.ts'
import type { TestUser } from './helpers/stack.ts'

// «Blekk» (M2.1): every screen in both themes under axe, the keyboard in the side menu, its flyouts, the view tabs and the row
// actions, the component overview kept out of a production build, and the visual references of four screens (dashboard, posts,
// editor, settings) in both themes at both widths. The references are in blekk.spec.ts-snapshots/; a change to the look fails
// here until they are made again on purpose (`pnpm --filter @toascribe/admin e2e -- blekk.spec.ts --update-snapshots`). What
// changes from run to run (the greeting, counts, names, dates, other specs' posts) is masked.

let admin: TestUser

test.beforeAll(async () => {
  admin = await createUser('administrator', 'blekk')
})

test.beforeEach(async () => {
  await resetPreferences(admin.username)
})

/** Sets the account's theme as the profile page does. */
async function useTheme(page: Page, scheme: 'light' | 'dark'): Promise<void> {
  const session = (await (await page.request.get('/api/v1/auth/session')).json()) as { csrfToken: string }
  const answer = await page.request.patch('/api/v1/me/preferences', {
    data: { adminColorScheme: scheme },
    headers: { 'X-CSRF-Token': session.csrfToken, origin: new URL(page.url()).origin },
  })
  expect(answer.ok(), await answer.text()).toBe(true)
}

const isPhone = () => test.info().project.name.startsWith('phone')

/** Every signed-in screen of the admin, by address and the heading it shows. */
const SCREENS: readonly (readonly [path: string, heading: string | RegExp])[] = [
  ['/admin/', /^God (morgen|formiddag|ettermiddag|kveld), /],
  ['/admin/updates', 'Oppdateringer'],
  ['/admin/posts', 'Innlegg'],
  ['/admin/posts/new', 'Legg til innlegg'],
  ['/admin/categories', 'Kategorier'],
  ['/admin/tags', 'Stikkord'],
  ['/admin/media', 'Mediebibliotek'],
  ['/admin/media/new', 'Last opp ny mediefil'],
  ['/admin/pages', 'Sider'],
  ['/admin/pages/new', 'Legg til side'],
  ['/admin/appearance/customize', 'Tilpass'],
  ['/admin/appearance/menus', 'Menyer'],
  ['/admin/appearance/global-sets', 'Globale sett'],
  ['/admin/users', 'Brukere'],
  ['/admin/users/new', 'Legg til ny bruker'],
  ['/admin/profile', 'Profil'],
  ['/admin/tools/site-health', 'Nettstedshelse'],
  ['/admin/settings/general', 'Generelle innstillinger'],
  ['/admin/settings/writing', 'Skriveinnstillinger'],
  ['/admin/settings/reading', 'Leseinnstillinger'],
  ['/admin/settings/media', 'Mediainnstillinger'],
  ['/admin/settings/privacy', 'Personvern'],
  ['/admin/settings/permalinks', 'Permalenkeinnstillinger'],
]

for (const scheme of ['light', 'dark'] as const) {
  test(`every screen has no axe violations, ${scheme}`, async ({ page }) => {
    test.setTimeout(240_000)
    await signIn(page, admin)
    await useTheme(page, scheme)
    for (const [path, heading] of SCREENS) {
      await page.goto(path)
      await expect(page.locator('html')).toHaveClass(scheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeAttached()
      await expectNoAxeViolations(page, `${path}, ${scheme}`)
    }
  })
}

test('the sign-in screen has no axe violations in either theme of the system', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto('/admin/login')
    await expect(page.getByRole('heading', { level: 1, name: 'Logg inn' })).toBeVisible()
    await expectNoAxeViolations(page, `the sign-in screen, ${scheme}`)
  }
})

test.describe('the keyboard', () => {
  test('opens another section of the side menu as a flyout, and Escape gives the focus back', async ({ page }) => {
    await signIn(page, admin)
    if (isPhone()) {
      await page.getByRole('button', { name: 'Åpne sidepanel' }).click()
    }
    const menu = page.getByRole('navigation', { name: 'Hovedmeny' })
    const opener = menu.getByRole('button', { name: 'Vis undermenyen til Innlegg' })
    await opener.focus()
    await page.keyboard.press('Enter')
    const flyout = page.getByRole('list', { name: 'Innlegg' })
    await expect(flyout.getByRole('link', { name: 'Alle innlegg' })).toBeVisible()
    await expect(flyout.getByRole('link')).toContainText(['Alle innlegg', 'Legg til nytt', 'Kategorier', 'Stikkord'])
    // The focus is in the flyout: Tab reaches its links.
    await expect(flyout.locator(':focus')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(flyout).toHaveCount(0)
    await expect(opener).toBeFocused()

    // Enter on a link of the flyout goes there, and the section opens in the menu.
    await opener.press('Enter')
    await flyout.getByRole('link', { name: 'Kategorier' }).press('Enter')
    await expect(page).toHaveURL(/\/admin\/categories$/)
    if (isPhone()) {
      await page.getByRole('button', { name: 'Åpne sidepanel' }).click()
    }
    await expect(menu.getByRole('link', { name: 'Kategorier' })).toHaveAttribute('aria-current', 'page')
  })

  test('folds the side menu to icons and opens a section from its icon', async ({ page }) => {
    test.skip(isPhone(), 'below lg the menu slides in; the next test covers it')
    await signIn(page, admin)
    const fold = page.getByRole('button', { name: 'Skjul sidepanel' })
    await fold.focus()
    await page.keyboard.press('Enter')
    const menu = page.getByRole('navigation', { name: 'Hovedmeny' })
    const section = menu.getByRole('button', { name: 'Media' })
    await section.focus()
    await page.keyboard.press('Enter')
    const flyout = page.getByRole('list', { name: 'Media' })
    await expect(flyout.getByRole('link', { name: 'Bibliotek' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(section).toBeFocused()
    await page.getByRole('button', { name: 'Utvid sidepanel' }).press('Enter')
    await expect(menu.getByRole('link', { name: 'Media' })).toBeVisible()
  })

  test('slides the side menu in on a phone and out with Escape', async ({ page }) => {
    test.skip(!isPhone(), 'from lg the menu is always there')
    await signIn(page, admin)
    const menu = page.getByRole('navigation', { name: 'Hovedmeny' })
    await expect(menu).toBeHidden()
    const open = page.getByRole('button', { name: 'Åpne sidepanel' })
    await open.focus()
    await page.keyboard.press('Enter')
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
  })

  test('moves through the view tabs with Tab and opens one with Enter', async ({ page }) => {
    await signIn(page, admin)
    await page.goto('/admin/posts')
    const views = page.getByRole('navigation', { name: 'Innlegg etter status' })
    const all = views.getByRole('link', { name: /^Alle \(\d+\)$/ })
    await expect(all).toHaveAttribute('aria-current', 'page')
    await all.focus()
    await page.keyboard.press('Tab')
    const next = views.getByRole('link').nth(1)
    await expect(next).toBeFocused()
    const name = (await next.textContent())?.trim().split(/\s/)[0] ?? ''
    await page.keyboard.press('Enter')
    await expect(views.getByRole('link', { name: new RegExp(`^${name} \\(\\d+\\)$`) })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  test('shows a row’s actions when the keyboard reaches them, and runs one with Enter', async ({ page }) => {
    await signIn(page, admin)
    await page.goto('/admin/posts')
    const table = page.getByRole('table', { name: 'Innleggsliste' })
    const row = table.getByRole('row').nth(1)
    const actions = row.getByRole('list', { name: /^Handlinger for / })
    // From md, under a fine pointer, the actions wait for the pointer or the keyboard (the sketch shows them on the hovered row);
    // below md the rows stack and the actions are always there (M2.1, as WordPress on a phone).
    await expect(actions).toHaveCSS('opacity', isPhone() ? '1' : '0')
    const edit = actions.getByRole('link', { name: /^Rediger / })
    await edit.focus()
    await expect(actions).toHaveCSS('opacity', '1')
    await page.keyboard.press('Tab')
    const quick = actions.getByRole('button', { name: /^Hurtigrediger / })
    await expect(quick).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: /Hurtigrediger/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(quick).toBeFocused()
  })
})

test('the editor title shows the focus ring', async ({ page }) => {
  await signIn(page, admin)
  await page.goto('/admin/posts/new')
  const title = page.getByLabel('Tittel', { exact: true })
  await title.focus()
  await expect(title).toHaveCSS('outline-style', 'solid')
  await expect(title).toHaveCSS('outline-width', '2px')
})

test('a flyout the pointer opens leaves the keyboard focus where it was', async ({ page }) => {
  test.skip(isPhone(), 'below lg the menu is a slide-over')
  await signIn(page, admin)
  await page.goto('/admin/settings/general')
  const field = page.getByLabel('Nettstedstittel')
  await field.focus()
  await page.getByRole('navigation', { name: 'Hovedmeny' }).getByRole('link', { name: 'Innlegg', exact: true }).hover()
  await expect(page.getByRole('list', { name: 'Innlegg' })).toBeVisible()
  await expect(field).toBeFocused()
  await page.mouse.move(900, 600)
  await expect(page.getByRole('list', { name: 'Innlegg' })).toHaveCount(0)
  await expect(field).toBeFocused()
})

test('a list stacks its rows on a phone: title, status and date, the actions, and the checkbox', async ({ page }) => {
  test.skip(!isPhone(), 'from md the list is a table with its columns')
  await signIn(page, admin)
  await page.goto('/admin/posts')
  const table = page.getByRole('table', { name: 'Innleggsliste' })
  await expect(table.getByRole('columnheader', { name: 'Forfatter' })).toBeHidden()
  await expect(table.getByRole('columnheader', { name: 'Dato' })).toBeHidden()
  const row = table.getByRole('row').nth(1)
  await expect(row.getByRole('checkbox')).toBeVisible()
  await expect(row.getByText(/^(Publisert|Sist endret|Planlagt)$/).filter({ visible: true })).toBeVisible()
  await expect(row.getByRole('list', { name: /^Handlinger for / })).toHaveCSS('opacity', '1')
  // Nothing scrolls sideways: the table fits its box.
  const frame = page.getByRole('region', { name: 'Innleggsliste' })
  expect(await frame.evaluate((box) => box.scrollWidth <= box.clientWidth)).toBe(true)
})

test('the component overview is not in a production build', async ({ page }) => {
  await signIn(page, admin)
  const answer = await page.request.get('/admin/_ui')
  expect(answer.status()).toBe(404)
})

/** Calls the api as the signed-in page (session cookie and CSRF token). */
async function api(page: Page, method: 'GET' | 'POST', path: string, data?: unknown): Promise<Record<string, unknown>> {
  const session = (await (await page.request.get('/api/v1/auth/session')).json()) as { csrfToken: string }
  const answer = await page.request.fetch(`/api/v1${path}`, {
    method,
    headers: { 'X-CSRF-Token': session.csrfToken, origin: new URL(page.url()).origin },
    ...(data === undefined ? {} : { data }),
  })
  expect(answer.ok(), await answer.text()).toBe(true)
  return (await answer.json()) as Record<string, unknown>
}

/**
 * The fixed items the stacked lists are drawn with: the same names every run, made once in the e2e database (it keeps its data
 * between runs), so the 375 px references show real rows.
 */
const REFERENCE = 'Blekk-referanse'
async function ensureReferenceItems(page: Page): Promise<void> {
  for (const title of [`${REFERENCE} én`, `${REFERENCE} to`]) {
    const found = await api(page, 'GET', `/content?type=post&search=${encodeURIComponent(title)}&per_page=1`)
    if (found['total'] === 0) {
      await api(page, 'POST', '/content', { type: 'post', status: 'draft', title, blocks: [] })
    }
  }
  const terms = await api(page, 'GET', `/taxonomies/category/terms?search=${encodeURIComponent(REFERENCE)}`)
  if (terms['total'] === 0) {
    await api(page, 'POST', '/taxonomies/category/terms', { name: REFERENCE })
  }
}

/** The parts of a screen that change from run to run. */
function dynamicParts(page: Page): Locator[] {
  return [
    // The account at the foot of the menu and in the top bar: a new name each run.
    page.getByRole('button', { name: /^Hei, / }),
  ]
}

/**
 * What changes from run to run on the dashboard, and with it the height of a card, is taken out of the picture before it is taken:
 * text that only changes is made invisible (the layout stays), lists whose length changes are removed. Through the CSSOM, which the
 * admin's CSP allows (an injected stylesheet, Playwright's `stylePath`, is refused, as it should be).
 */
async function steadyDashboard(page: Page): Promise<void> {
  await page.evaluate(() => {
    const hide = [
      'main h1',
      'main p:has(+ h1)',
      "[aria-labelledby='stats-heading'] li > span",
      "[aria-labelledby='health-heading'] [aria-hidden='true']",
      "[aria-labelledby='health-heading'] p",
      "[aria-labelledby='health-heading'] .rounded-full",
      "[aria-labelledby='version-heading'] p",
      "[aria-labelledby='notices-heading'] li",
    ]
    const remove = [
      "[aria-labelledby='health-heading'] ul",
      "[aria-labelledby='activity-heading'] ul",
      "[aria-labelledby='quick-draft-list']",
    ]
    for (const element of document.querySelectorAll<HTMLElement>(hide.join(','))) element.style.visibility = 'hidden'
    for (const element of document.querySelectorAll<HTMLElement>(remove.join(','))) element.style.display = 'none'
  })
}

const SNAPSHOT = {
  fullPage: true,
  animations: 'disabled',
  caret: 'hide',
  maxDiffPixelRatio: 0.002,
} as const

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`the look, ${scheme}`, () => {
    test(`dashboard (${scheme})`, async ({ page }) => {
      await signIn(page, admin)
      await useTheme(page, scheme)
      await page.reload()
      await expect(dashboardHeading(page)).toBeVisible()
      await expect(page.getByRole('region', { name: 'Hurtigutkast' })).toBeVisible()
      await expect(page.getByRole('region', { name: 'Nettstedshelse' }).getByRole('link')).toBeVisible()
      await steadyDashboard(page)
      await expect(page).toHaveScreenshot(`dashboard-${scheme}.png`, {
        ...SNAPSHOT,
        // The greeting, the counts, the checks and the lists change from run to run: steadyDashboard took them out.
        mask: dynamicParts(page),
      })
    })

    test(`posts list (${scheme})`, async ({ page }) => {
      await signIn(page, admin)
      await useTheme(page, scheme)
      await page.goto('/admin/posts')
      const table = page.getByRole('table', { name: 'Innleggsliste' })
      await expect(table).toBeVisible()
      await expect(page).toHaveScreenshot(`posts-${scheme}.png`, {
        ...SNAPSHOT,
        mask: [
          ...dynamicParts(page),
          page.getByRole('navigation', { name: 'Innlegg etter status' }).locator('.font-mono'),
          page.getByRole('navigation', { name: 'Sideinndeling' }),
          table.locator('tbody'),
          page.getByText(/^\d+ elementer?$/),
          page.locator('#content-month'),
        ],
      })
    })

    test(`stacked lists on a phone (${scheme})`, async ({ page }) => {
      test.skip(!isPhone(), 'the rows stack below md only')
      await signIn(page, admin)
      await useTheme(page, scheme)
      await ensureReferenceItems(page)
      await page.goto(`/admin/posts?search=${encodeURIComponent(REFERENCE)}`)
      const posts = page.getByRole('table', { name: 'Innleggsliste' })
      await expect(posts.getByRole('row')).toHaveCount(3)
      await expect(posts).toHaveScreenshot(`posts-stacked-${scheme}.png`, {
        animations: 'disabled',
        caret: 'hide',
        // The date of a draft is when it was made.
        mask: [posts.locator('.font-mono')],
      })
      await page.goto(`/admin/categories?search=${encodeURIComponent(REFERENCE)}`)
      const terms = page.getByRole('table', { name: 'Kategoriliste' })
      await expect(terms.getByRole('row')).toHaveCount(2)
      await expect(terms).toHaveScreenshot(`categories-stacked-${scheme}.png`, {
        animations: 'disabled',
        caret: 'hide',
      })
    })

    test(`editor (${scheme})`, async ({ page }) => {
      await signIn(page, admin)
      await useTheme(page, scheme)
      await page.goto('/admin/posts/new')
      await expect(page.getByLabel('Tittel', { exact: true })).toBeVisible()
      await expect(page).toHaveScreenshot(`editor-${scheme}.png`, {
        ...SNAPSHOT,
        // The author is this run's account.
        mask: [page.locator('#editor-sidebar').getByText(admin.username)],
      })
    })

    test(`settings (${scheme})`, async ({ page }) => {
      await signIn(page, admin)
      await useTheme(page, scheme)
      await page.goto('/admin/settings/general')
      await expect(page.getByRole('heading', { level: 1, name: 'Generelle innstillinger' })).toBeVisible()
      await expect(page).toHaveScreenshot(`settings-${scheme}.png`, {
        ...SNAPSHOT,
        // Other specs change these settings, and the administrator's address is a new one each run.
        mask: [
          ...dynamicParts(page),
          page.locator('main input, main [role="combobox"], main textarea, main [role="checkbox"]'),
          page.getByText(/^Adressen nå er /),
        ],
      })
    })
  })
}
