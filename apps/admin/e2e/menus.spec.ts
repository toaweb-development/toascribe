import type { APIRequestContext } from '@playwright/test'

import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { signIn } from './helpers/screens.ts'
import { baseUrl, createUser, uniqueName } from './helpers/stack.ts'
import type { TestUser } from './helpers/stack.ts'

// «Utseende → Menyer» and «Globale sett» (M1.5, K-132, K-106): a menu of three levels made in the screen, with the buttons and the
// keyboard, placed in the theme's main menu and seen on the site (the «Meny» button on a phone, submenus opened with the keyboard);
// and the theme's «Bunntekst» set, made empty by the screen and shown in the site's footer once it has blocks. 375 px and 1280 px,
// with axe and the CSP check of the fixture.

let admin: TestUser

test.beforeAll(async () => {
  admin = await createUser('administrator', 'appearanceadmin')
})

async function api(request: APIRequestContext) {
  const origin = baseUrl()
  const login = await request.post('/api/v1/auth/login', {
    data: { login: admin.username, password: admin.password },
    headers: { origin },
  })
  const { csrfToken } = (await login.json()) as { csrfToken: string }
  return { origin, 'x-csrf-token': csrfToken }
}

test('a menu of three levels, placed in the main menu and used on the site', async ({ page, playwright }, testInfo) => {
  const request = await playwright.request.newContext({ baseURL: baseUrl() })
  const headers = await api(request)
  const name = uniqueName('meny')
  for (const title of [`Topp ${name}`, `Midt ${name}`, `Bunn ${name}`]) {
    const res = await request.post('/api/v1/content', { data: { type: 'page', status: 'publish', title }, headers })
    expect(res.status()).toBe(201)
  }

  try {
    await signIn(page, admin)
    await page.goto('/admin/appearance/menus')
    await expect(page.getByRole('heading', { name: 'Menyer', level: 1 })).toBeVisible()
    await page.getByLabel('Ny meny').fill(`Hoved ${name}`)
    await page.getByRole('button', { name: 'Opprett meny' }).click()
    await expect(page.getByText(`Menyen «Hoved ${name}» er opprettet.`)).toBeVisible()

    const pages = page.getByRole('group', { name: 'Sider' })
    for (const title of [`Topp ${name}`, `Midt ${name}`, `Bunn ${name}`]) await pages.getByLabel(title).check()
    await pages.getByRole('button', { name: 'Legg til i menyen: Sider' }).click()
    await expect(page.getByRole('listitem', { name: `Midt ${name}, nivå 1` })).toBeVisible()
    await expectNoAxeViolations(page, 'Appearance → Menus')

    // «Midt» in under «Topp» with its button, «Bunn» in under «Midt» with Alt and the arrow keys.
    await page.getByRole('button', { name: `Flytt «Midt ${name}» inn under punktet over` }).click()
    await expect(page.getByRole('listitem', { name: `Midt ${name}, nivå 2` })).toBeVisible()
    await page.getByRole('button', { name: `Flytt «Bunn ${name}» inn under punktet over` }).click()
    await page.getByRole('listitem', { name: `Bunn ${name}, nivå 2` }).focus()
    await page.keyboard.press('Alt+ArrowRight')
    await expect(page.getByRole('listitem', { name: `Bunn ${name}, nivå 3` })).toBeVisible()
    await page.getByRole('button', { name: 'Lagre meny' }).click()
    await expect(page.getByText('Menyen er lagret.')).toBeVisible()

    await page.getByRole('tab', { name: 'Administrer plasseringer' }).click()
    await page.getByRole('combobox', { name: 'Hovedmeny' }).click()
    await page.getByRole('option', { name: `Hoved ${name}` }).click()
    await page.getByRole('button', { name: 'Lagre endringer' }).click()
    await expect(page.getByText('Plasseringene er lagret.')).toBeVisible()

    // The site: on a phone the menu is behind «Meny»; the submenus open with the keyboard and close with Escape.
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Hovedmeny' })
    if (testInfo.project.name === 'phone-375') {
      await expect(nav.getByRole('link', { name: `Topp ${name}` })).toBeHidden()
      await nav.getByRole('button', { name: 'Meny' }).click()
    }
    await expect(nav.getByRole('link', { name: `Topp ${name}` })).toBeVisible()
    await expect(nav.getByRole('link', { name: `Midt ${name}` })).toBeHidden()
    await nav.getByRole('button', { name: `Undermeny for Topp ${name}` }).focus()
    await page.keyboard.press('Enter')
    await expect(nav.getByRole('link', { name: `Midt ${name}` })).toBeVisible()
    await nav.getByRole('button', { name: `Undermeny for Midt ${name}` }).press('Enter')
    await expect(nav.getByRole('link', { name: `Bunn ${name}` })).toBeVisible()
    await expectNoAxeViolations(page, 'the site with the main menu open')
    await page.keyboard.press('Escape')
    await expect(nav.getByRole('link', { name: `Bunn ${name}` })).toBeHidden()
    await nav.getByRole('link', { name: `Midt ${name}` }).click()
    await expect(page.getByRole('heading', { level: 1, name: `Midt ${name}` })).toBeVisible()
  } finally {
    await request.put('/api/v1/menu-locations', { data: { locations: { primary: null } }, headers })
    await request.dispose()
  }
})

test("the theme's «Bunntekst» set is made, and the footer shows its blocks", async ({ page, playwright }) => {
  await signIn(page, admin)
  await page.goto('/admin/appearance/global-sets')
  await expect(page.getByRole('link', { name: 'Bunntekst' })).toBeVisible()
  await expectNoAxeViolations(page, 'Appearance → Global sets')

  const request = await playwright.request.newContext({ baseURL: baseUrl() })
  const headers = await api(request)
  const sets = (await (await request.get('/api/v1/global-sets', { headers })).json()) as {
    items: { id: string; slug: string }[]
  }
  const footer = sets.items.find((set) => set.slug === 'bunntekst')
  expect(footer).toBeDefined()
  const words = `Ring oss ${uniqueName('sett')}`
  const res = await request.patch(`/api/v1/global-sets/${footer?.id ?? ''}`, {
    data: {
      blocks: [
        {
          id: 'b_footer1',
          type: 'core/paragraph',
          version: 1,
          attrs: { content: [{ type: 'text', text: words }] },
          children: [],
        },
      ],
    },
    headers,
  })
  expect(res.status()).toBe(200)
  await request.dispose()

  await page.goto(`/admin/appearance/global-sets/${footer?.id ?? ''}`)
  await expect(page.getByRole('heading', { name: 'Globalt sett: Bunntekst' })).toBeVisible()
  await page.goto('/')
  await expect(page.getByRole('contentinfo').getByText(words)).toBeVisible()
})
