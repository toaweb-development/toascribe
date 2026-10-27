import type { APIRequestContext } from '@playwright/test'

import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { signIn } from './helpers/screens.ts'
import { baseUrl, createUser, uniqueName } from './helpers/stack.ts'
import type { TestUser } from './helpers/stack.ts'

// What a page says about itself (M1.6, K-224), in the browser and under the CSP: the title pattern, the canonical address on the
// site's origin, Open Graph and Twitter, and JSON-LD that parses and names the post; and «Deling og søkemotorer» on «Lesing».
// 375 px and 1280 px, with axe and the CSP check of the fixture.

let admin: TestUser

test.beforeAll(async () => {
  admin = await createUser('administrator', 'seoadmin')
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

test("a post's head: title, canonical, cards and structured data", async ({ page, playwright }) => {
  const request = await playwright.request.newContext({ baseURL: baseUrl() })
  const headers = await api(request)
  const name = uniqueName('seo')
  const res = await request.post('/api/v1/content', {
    data: {
      type: 'post',
      status: 'publish',
      title: `Søk & finn ${name}`,
      slug: name,
      seo: { description: 'En kort beskrivelse for deling.' },
    },
    headers,
  })
  expect(res.status()).toBe(201)
  await request.dispose()

  await page.goto(`/${name}/`)
  await expect(page).toHaveTitle(new RegExp(`^Søk & finn ${name} – `))
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${baseUrl()}/${name}/`)
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article')
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', `${baseUrl()}/${name}/`)
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'En kort beskrivelse for deling.')
  await expect(page.locator('meta[name="twitter:card"]')).toHaveCount(1)
  const jsonLd = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? '{}') as {
    '@graph': { '@type': string; headline?: string }[]
  }
  expect(jsonLd['@graph'].find((node) => node['@type'] === 'BlogPosting')?.headline).toBe(`Søk & finn ${name}`)
  expect(jsonLd['@graph'].map((node) => node['@type'])).toContain('BreadcrumbList')

  // The front page: «Nettsted – Slagord» (or the name alone), canonical /, WebSite.
  await page.goto('/')
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${baseUrl()}/`)
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'website')
})

test('«Deling og søkemotorer» on «Lesing»', async ({ page }) => {
  await signIn(page, admin)
  await page.goto('/admin/settings/reading')
  await expect(page.getByRole('group', { name: 'Deling og søkemotorer' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Velg bilde' }).first()).toBeVisible()
  await page.getByRole('radio', { name: 'En person' }).check()
  await expect(page.getByRole('combobox', { name: 'Person' })).toBeVisible()
  await page.getByRole('radio', { name: 'En organisasjon' }).check()
  await expect(page.getByLabel('Organisasjonens navn')).toBeVisible()
  await expectNoAxeViolations(page, 'Settings → Reading with sharing')
})
