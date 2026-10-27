import type { APIRequestContext } from '@playwright/test'

import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { signIn } from './helpers/screens.ts'
import { baseUrl, createUser, uniqueName } from './helpers/stack.ts'
import type { TestUser } from './helpers/stack.ts'

// The public site with the default theme (M1.4): the front page with «Les mer», a post split by page breaks, a category archive,
// the search, 404, a password-protected post, a preview link, `/?p=` and the toolbar of a signed-in person. Each test runs at
// 375 px and 1280 px; the fixture fails a test on any console message or CSP violation, and axe runs on each kind of page.
// The content is made through the api by an editor, in a request context of its own; the page that looks at it is a visitor's.

let author: TestUser

test.beforeAll(async () => {
  author = await createUser('editor', 'sitewriter')
})

let serial = 0
const blockId = () => `b_e2e${Date.now().toString(36)}${String((serial += 1))}`
const text = (value: string) => [{ type: 'text', text: value }]
const paragraph = (value: string) => ({
  id: blockId(),
  type: 'core/paragraph',
  version: 1,
  attrs: { content: text(value) },
  children: [],
})
const marker = (type: 'core/more' | 'core/nextpage', attrs: Record<string, unknown> = {}) => ({
  id: blockId(),
  type,
  version: 1,
  attrs,
  children: [],
})

/** An api client signed in as the author: the session cookie in the request context, the CSRF token in each change. */
async function writer(request: APIRequestContext) {
  const origin = baseUrl()
  const login = await request.post('/api/v1/auth/login', {
    data: { login: author.username, password: author.password },
    headers: { origin },
  })
  expect(login.status()).toBe(200)
  const { csrfToken } = (await login.json()) as { csrfToken: string }
  const headers = { origin, 'x-csrf-token': csrfToken }
  return {
    async create(body: Record<string, unknown>): Promise<{ id: string; shortId: number; slug: string }> {
      const res = await request.post('/api/v1/content', { data: body, headers })
      expect(res.status(), await res.text()).toBe(201)
      return (await res.json()) as { id: string; shortId: number; slug: string }
    },
    async category(name: string): Promise<{ id: string; slug: string }> {
      const res = await request.post('/api/v1/taxonomies/category/terms', { data: { name }, headers })
      expect(res.status(), await res.text()).toBe(201)
      return (await res.json()) as { id: string; slug: string }
    },
    async previewPath(id: string): Promise<string> {
      const res = await request.post(`/api/v1/content/${id}/preview-link`, { headers })
      expect(res.status()).toBe(200)
      return ((await res.json()) as { path: string }).path
    },
    async update(id: string, body: Record<string, unknown>): Promise<void> {
      const res = await request.patch(`/api/v1/content/${id}`, { data: body, headers })
      expect(res.status(), await res.text()).toBe(200)
    },
  }
}

test('the front page lists a post with «Les mer», and the post shows its pages', async ({ page, playwright }) => {
  const request = await playwright.request.newContext({ baseURL: baseUrl() })
  const api = await writer(request)
  const name = uniqueName('sitepost')
  const post = await api.create({
    type: 'post',
    status: 'publish',
    title: `Fjelltur ${name}`,
    blocks: [
      paragraph('Innledningen står i lista.'),
      marker('core/more', { customText: 'Les hele turen' }),
      paragraph('Første side av turen.'),
      marker('core/nextpage'),
      paragraph('Andre side av turen.'),
    ],
  })
  await request.dispose()

  await page.goto('/')
  const summary = page.getByRole('article').filter({ has: page.getByRole('heading', { name: `Fjelltur ${name}` }) })
  await expect(summary.getByText('Innledningen står i lista.')).toBeVisible()
  await expect(summary.getByText('Første side av turen.')).toHaveCount(0)
  await expectNoAxeViolations(page, 'the front page')

  await summary.getByRole('link', { name: /Les hele turen/ }).click()
  await expect(page).toHaveURL(new RegExp(`/${post.slug}/$`))
  await expect(page.getByRole('heading', { level: 1, name: `Fjelltur ${name}` })).toBeVisible()
  await expect(page.getByText('Første side av turen.')).toBeVisible()
  await expect(page.getByText('Andre side av turen.')).toHaveCount(0)
  await expectNoAxeViolations(page, 'a post with page breaks')

  await page.getByRole('navigation', { name: 'Sider i innlegget' }).getByRole('link', { name: 'Side 2' }).click()
  await expect(page).toHaveURL(new RegExp(`/${post.slug}/2/$`))
  await expect(page.getByText('Andre side av turen.')).toBeVisible()
  await expect(page.getByText('Første side av turen.')).toHaveCount(0)
})

test('a category archive, the search and 404', async ({ page, playwright, allowFailedRequests }) => {
  // The 404 page answers 404, which the browser logs.
  allowFailedRequests()

  const request = await playwright.request.newContext({ baseURL: baseUrl() })
  const api = await writer(request)
  const name = uniqueName('sitecat')
  const category = await api.category(`Turer ${name}`)
  await api.create({
    type: 'post',
    status: 'publish',
    title: `Arkivert ${name}`,
    categories: [category.id],
    blocks: [paragraph(`Ord til søket ${name}`)],
  })
  // A page with a Query Loop of that category (K-085).
  const listing = await api.create({
    type: 'page',
    status: 'publish',
    title: `Turliste ${name}`,
    blocks: [
      { id: blockId(), type: 'core/query', version: 1, attrs: { category: category.slug, perPage: 3 }, children: [] },
    ],
  })
  await request.dispose()

  await page.goto(`/category/${category.slug}/`)
  await expect(page.getByRole('heading', { level: 1, name: `Kategori: Turer ${name}` })).toBeVisible()
  await expect(page.getByRole('link', { name: `Arkivert ${name}` })).toBeVisible()
  await expectNoAxeViolations(page, 'a category archive')

  await page.getByRole('searchbox', { name: 'Søk' }).fill(name)
  await page.getByRole('button', { name: 'Søk' }).click()
  await expect(page).toHaveURL(/\?s=/)
  await expect(page.getByRole('heading', { level: 1, name: `Søk etter «${name}»` })).toBeVisible()
  await expect(page.getByRole('link', { name: `Arkivert ${name}` })).toBeVisible()
  await expectNoAxeViolations(page, 'the search')

  await page.goto(`/${listing.slug}/`)
  await expect(page.getByRole('link', { name: `Arkivert ${name}` })).toBeVisible()
  await expectNoAxeViolations(page, 'a page with a Query Loop')

  const missing = await page.goto(`/${uniqueName('finnes-ikke')}/`)
  expect(missing?.status()).toBe(404)
  await expect(page.getByRole('heading', { level: 1, name: 'Fant ikke siden' })).toBeVisible()
  await expectNoAxeViolations(page, 'the 404 page')
})

test('a password-protected post shows the form, and its text only with the password', async ({
  page,
  playwright,
  allowFailedRequests,
}) => {
  // A wrong password is a 400, which the browser logs.
  allowFailedRequests()

  const request = await playwright.request.newContext({ baseURL: baseUrl() })
  const api = await writer(request)
  const name = uniqueName('sitelocked')
  const post = await api.create({
    type: 'post',
    status: 'publish',
    title: `Låst ${name}`,
    password: 'sesam',
    blocks: [paragraph(`Hemmelig tekst ${name}`)],
  })
  await request.dispose()

  const first = await page.goto(`/${post.slug}/`)
  expect(await first?.text()).not.toContain(`Hemmelig tekst ${name}`)
  await expect(page.getByLabel('Passord')).toBeVisible()
  await expectNoAxeViolations(page, 'the password form')

  await page.getByLabel('Passord').fill('feil')
  await page.getByRole('button', { name: 'Åpne' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Passordet er feil.' })).toBeVisible()
  await page.getByLabel('Passord').fill('sesam')
  await page.getByRole('button', { name: 'Åpne' }).click()
  await expect(page.getByText(`Hemmelig tekst ${name}`)).toBeVisible()
  // The cookie opens it on the next visit too.
  await page.reload()
  await expect(page.getByText(`Hemmelig tekst ${name}`)).toBeVisible()
})

test('the password form works without JavaScript', async ({ browser, playwright }) => {
  const request = await playwright.request.newContext({ baseURL: baseUrl() })
  const api = await writer(request)
  const name = uniqueName('sitenojs')
  const post = await api.create({
    type: 'post',
    status: 'publish',
    title: `Uten skript ${name}`,
    password: 'sesam',
    blocks: [paragraph(`Skjult ${name}`)],
  })
  await request.dispose()

  const context = await browser.newContext({ baseURL: baseUrl(), javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto(`/${post.slug}/`)
  await page.getByLabel('Passord').fill('feil')
  await page.getByRole('button', { name: 'Åpne' }).click()
  await expect(page).toHaveURL(new RegExp(`/${post.slug}/\\?postpass=wrong$`))
  await expect(page.getByText('Passordet er feil.')).toBeVisible()
  await page.getByLabel('Passord').fill('sesam')
  await page.getByRole('button', { name: 'Åpne' }).click()
  await expect(page).toHaveURL(new RegExp(`/${post.slug}/$`))
  await expect(page.getByText(`Skjult ${name}`)).toBeVisible()
  await context.close()
})

test('«Forhåndsvis» in the list opens the signed link on the site', async ({ page, context, playwright }) => {
  await signIn(page, author)
  const name = uniqueName('listpreview')
  const request = await playwright.request.newContext({ baseURL: baseUrl() })
  const api = await writer(request)
  await api.create({ type: 'post', status: 'draft', title: `Listekladd ${name}`, blocks: [paragraph('Fra lista.')] })
  await request.dispose()
  await page.goto(`/admin/posts?search=${name}`)
  const opened = context.waitForEvent('page')
  await page.getByRole('button', { name: `Forhåndsvis «Listekladd ${name}»` }).click()
  const tab = await opened
  await expect(tab).toHaveURL(/\/\?preview=v1\./)
  await expect(tab.getByRole('heading', { level: 1, name: `Listekladd ${name}` })).toBeVisible()
})

test('a preview link shows a draft, and `/?p=` goes to the post', async ({ page, playwright, allowFailedRequests }) => {
  // The draft's own address is a 404, which the browser logs.
  allowFailedRequests()

  const request = await playwright.request.newContext({ baseURL: baseUrl() })
  const api = await writer(request)
  const name = uniqueName('sitedraft')
  const draft = await api.create({
    type: 'post',
    status: 'draft',
    title: `Kladd ${name}`,
    blocks: [paragraph('Uferdig.')],
  })
  const path = await api.previewPath(draft.id)
  const published = await api.create({ type: 'post', status: 'publish', title: `Publisert ${name}` })

  await page.goto(path)
  await expect(page.getByRole('heading', { level: 1, name: `Kladd ${name}` })).toBeVisible()
  await expect(page.getByText('Forhåndsvisning')).toBeVisible()
  await expectNoAxeViolations(page, 'a preview')
  expect((await page.goto(`/${draft.slug}/`))?.status()).toBe(404)

  await page.goto(`/?p=${String(published.shortId)}`)
  await expect(page).toHaveURL(new RegExp(`/${published.slug}/$`))
  await expect(page.getByRole('heading', { level: 1, name: `Publisert ${name}` })).toBeVisible()

  // A change shows at once.
  await api.update(published.id, { title: `Endret ${name}` })
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: `Endret ${name}` })).toBeVisible()
  await request.dispose()
})

test('a signed-in person sees the toolbar with «Rediger»; a visitor does not', async ({ page, playwright }) => {
  await page.goto('/hei-verden/')
  await expect(page.getByRole('navigation', { name: 'Verktøylinje' })).toHaveCount(0)
  await signIn(page, author)
  await page.goto('/hei-verden/')
  const toolbar = page.getByRole('navigation', { name: 'Verktøylinje' })
  await expect(toolbar.getByRole('link', { name: 'Rediger' })).toHaveAttribute('href', /^\/admin\/posts\//)
  await expect(toolbar.getByRole('link', { name: 'Kontrollpanel' })).toBeVisible()
  await expectNoAxeViolations(page, 'a post with the toolbar')
  // A visitor after them gets the page without it: nothing of a signed-in person's page is kept for others.
  const anonymous = await playwright.request.newContext({ baseURL: baseUrl() })
  const html = await (await anonymous.get('/hei-verden/')).text()
  expect(html).not.toContain('Verktøylinje')
  expect(html).not.toContain(author.username)
  await anonymous.dispose()
})
