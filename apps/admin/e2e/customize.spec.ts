import type { APIRequestContext } from '@playwright/test'

import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { signIn } from './helpers/screens.ts'
import { baseUrl, createUser, uniqueName } from './helpers/stack.ts'
import type { TestUser } from './helpers/stack.ts'

// «Utseende → Tilpass» (M1.5, K-150, K-151): the title, a theme colour and «Ekstra CSS» changed in the screen show in the preview
// beside it before anything is stored, and on the site once published; CSS that could end its <style> is refused. 375 px and
// 1280 px, with axe and the CSP check of the fixture (the preview frame's console included).

let admin: TestUser

test.beforeAll(async () => {
  admin = await createUser('administrator', 'customizeadmin')
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

test('Tilpass: the preview shows unsaved choices, and «Publiser» puts them on the site', async ({
  page,
  playwright,
  allowFailedRequests,
}) => {
  // The refused CSS is a 400, which the browser logs.
  allowFailedRequests()
  const request = await playwright.request.newContext({ baseURL: baseUrl() })
  const headers = await api(request)
  const before = (await (await request.get('/api/v1/customize?theme=default', { headers })).json()) as {
    identity: { blogname: string; blogdescription: string }
    customization: { colors: Record<string, string>; fonts: Record<string, string>; customCss: string }
  }
  const title = uniqueName('Tilpasset')

  try {
    await signIn(page, admin)
    await page.goto('/admin/appearance/customize')
    await expect(page.getByRole('heading', { name: 'Tilpass', level: 1 })).toBeVisible()
    const siteTitle = page.getByLabel('Nettstedstittel')
    await expect(siteTitle).toBeVisible()
    const preview = page.frameLocator('iframe[title^="Forhåndsvisning av nettstedet"]')
    await expect(preview.getByRole('banner')).toBeVisible()

    await siteTitle.fill(title)
    await page.getByLabel('Lenker og knapper', { exact: true }).fill('#7f1d1d')
    await page.getByRole('textbox', { name: 'Ekstra CSS' }).fill('body { outline: 3px solid rgb(1, 2, 3); }')
    await expect(preview.getByRole('link', { name: title })).toBeVisible()
    await expect(preview.locator('body')).toHaveCSS('outline-color', 'rgb(1, 2, 3)')
    await expectNoAxeViolations(page, 'Appearance → Customize')

    // Not stored yet: the site itself is as it was.
    const site = await page.context().newPage()
    await site.goto('/')
    await expect(site.getByRole('link', { name: title })).toHaveCount(0)

    // CSS that could end its <style> is refused, and nothing is stored.
    await page.getByRole('textbox', { name: 'Ekstra CSS' }).fill('</style><script>alert(1)</script>')
    await page.getByRole('button', { name: 'Publiser' }).click()
    await expect(page.getByRole('alert')).toContainText('Det gikk ikke')

    await page.getByRole('textbox', { name: 'Ekstra CSS' }).fill('body { outline: 3px solid rgb(1, 2, 3); }')
    await page.getByRole('button', { name: 'Publiser' }).click()
    await expect(page.getByText('Endringene er publisert.').first()).toBeVisible()

    await site.reload()
    await expect(site.getByRole('link', { name: title })).toBeVisible()
    await expect(site.locator('body')).toHaveCSS('outline-color', 'rgb(1, 2, 3)')
    await expect(site.locator('style#scribe-customize')).toHaveAttribute('nonce', /.*/)
    await expect(site).toHaveTitle(new RegExp(title))
    await site.close()
  } finally {
    await request.patch('/api/v1/customize', {
      data: {
        theme: 'default',
        identity: { blogname: before.identity.blogname, blogdescription: before.identity.blogdescription },
        colors: before.customization.colors,
        fonts: before.customization.fonts,
        customCss: before.customization.customCss,
      },
      headers,
    })
    await request.dispose()
  }
})

test("a theme's choices are not served on the public address (only the site reads them)", async ({ playwright }) => {
  const request = await playwright.request.newContext({ baseURL: baseUrl() })
  expect((await request.get('/api/v1/public/customize?theme=default')).status()).toBe(404)
  await request.dispose()
})
