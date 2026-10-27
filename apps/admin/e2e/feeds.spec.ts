import http from 'node:http'

import type { APIRequestContext } from '@playwright/test'

import { expect, test } from './helpers/fixtures.ts'
import { baseUrl, createUser, setSetting, uniqueName } from './helpers/stack.ts'
import type { TestUser } from './helpers/stack.ts'

// RSS, the sitemap and robots.txt (M1.6, K-222, K-223) through the proxy: the content types and character set, a new post in the
// feed and the sitemap at once, a category's feed under its address, the feed links in a page's head, and robots.txt and the
// sitemap following «Søkemotorsynlighet». 375 px and 1280 px, with the CSP check of the fixture on the pages opened in the browser.

let admin: TestUser

test.beforeAll(async () => {
  admin = await createUser('administrator', 'feedsadmin')
})

/** A GET with the path exactly as written, as some feed readers send it. */
function rawGet(path: string): Promise<{ status: number; location: string | undefined }> {
  const url = new URL(baseUrl())
  return new Promise((resolve, reject) => {
    const req = http.request({ host: url.hostname, port: url.port, path, method: 'GET' }, (res) => {
      res.resume()
      resolve({ status: res.statusCode ?? 0, location: res.headers.location })
    })
    req.on('error', reject)
    req.end()
  })
}

async function api(request: APIRequestContext) {
  const origin = baseUrl()
  const login = await request.post('/api/v1/auth/login', {
    data: { login: admin.username, password: admin.password },
    headers: { origin },
  })
  const { csrfToken } = (await login.json()) as { csrfToken: string }
  return { origin, 'x-csrf-token': csrfToken }
}

test('the feed, a category feed, the sitemap and robots.txt', async ({ page, playwright }) => {
  const request = await playwright.request.newContext({ baseURL: baseUrl() })
  const headers = await api(request)
  const name = uniqueName('strom')
  const category = await request.post('/api/v1/taxonomies/category/terms', { data: { name: `Kat ${name}` }, headers })
  expect(category.status()).toBe(201)
  const { id: categoryId, slug: categorySlug } = (await category.json()) as { id: string; slug: string }
  const post = await request.post('/api/v1/content', {
    data: { type: 'post', status: 'publish', title: `Strøm & ${name}`, categories: [categoryId] },
    headers,
  })
  expect(post.status()).toBe(201)

  try {
    const feed = await request.get('/feed/')
    expect(feed.status()).toBe(200)
    expect(feed.headers()['content-type']).toBe('application/rss+xml; charset=utf-8')
    const xml = await feed.text()
    expect(xml).toContain('<rss version="2.0"')
    expect(xml).toContain(`<title>Strøm &amp; ${name}</title>`)
    expect((await request.get('/feed', { maxRedirects: 0 })).headers()['location']).toBe('/feed/')

    const categoryFeed = await request.get(`/category/${categorySlug}/feed/`)
    expect(categoryFeed.status()).toBe(200)
    expect(await categoryFeed.text()).toContain(`<title>Strøm &amp; ${name}</title>`)
    expect((await request.get('/finnes-ikke-her/feed/')).status()).toBe(404)
    // A path whose dot segments leave `//host/feed` is no feed and goes nowhere (sent as written: Playwright would tidy it).
    for (const raw of ['/.//evil.example/feed', '/%2e//evil.example/feed']) {
      const answer = await rawGet(raw)
      expect(answer.status, raw).toBe(404)
      expect(answer.location, raw).toBeUndefined()
    }
    expect((await request.get('/sitemap-posts-0.xml')).status()).toBe(404)
    expect((await request.get('/sitemap-posts-999999.xml')).status()).toBe(404)

    const robots = await request.get('/robots.txt')
    expect(robots.headers()['content-type']).toBe('text/plain; charset=utf-8')
    expect(await robots.text()).toBe(`User-agent: *\nDisallow: /admin/\n\nSitemap: ${baseUrl()}/sitemap.xml\n`)

    const index = await request.get('/sitemap.xml')
    expect(index.headers()['content-type']).toBe('application/xml; charset=utf-8')
    expect(await index.text()).toContain(`<loc>${baseUrl()}/sitemap-posts-1.xml</loc>`)

    // In the browser: the sitemap and robots.txt open, and a page names the feeds in its head.
    await page.goto('/sitemap-categories-1.xml')
    await expect(page.locator('body')).toContainText(`/category/${categorySlug}/`)
    await page.goto('/robots.txt')
    await expect(page.locator('body')).toContainText('Disallow: /admin/')
    await page.goto(`/category/${categorySlug}/`)
    await expect(page.locator('link[rel="alternate"][type="application/rss+xml"]')).toHaveCount(2)
    await expect(page.locator(`link[rel="alternate"][href="/category/${categorySlug}/feed/"]`)).toHaveCount(1)

    // «Be søkemotorer om ikke å indeksere»: robots.txt shuts everything, and there is no sitemap.
    await setSetting('blog_public', false)
    try {
      expect(await (await request.get('/robots.txt')).text()).toBe('User-agent: *\nDisallow: /\n')
      expect((await request.get('/sitemap.xml')).status()).toBe(404)
    } finally {
      await setSetting('blog_public', true)
    }
  } finally {
    await request.dispose()
  }
})
