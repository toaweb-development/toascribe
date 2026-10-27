import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { signIn } from './helpers/screens.ts'
import { baseUrl, compose, createUser, uniqueName } from './helpers/stack.ts'
import type { TestUser } from './helpers/stack.ts'

// Maintenance mode (M1.7, K-288), turned on and off with `toa maintenance` in the api container: a visitor gets 503 with Retry-After
// and the maintenance page with the message, and nothing of the content; feeds and the sitemap answer 503 too; an administrator sees
// the site as usual, with a notice in the toolbar, and can still sign in to the admin. 375 px and 1280 px, with axe and the CSP check.

let admin: TestUser

test.beforeAll(async () => {
  admin = await createUser('administrator', 'maintadmin')
})

test.afterEach(async () => {
  await compose(['exec', '-T', 'api', 'toa', 'maintenance', 'off'])
})

test('visitors get the maintenance page with 503, the administrator the site', async ({
  page,
  playwright,
  allowFailedRequests,
}) => {
  // The 503 is the point; the browser logs it.
  allowFailedRequests()
  const message = `Tilbake snart ${uniqueName('vedlikehold')}`
  const secret = `Innlegg ${uniqueName('skjult')}`
  const writer = await playwright.request.newContext({ baseURL: baseUrl() })
  const login = await writer.post('/api/v1/auth/login', {
    data: { login: admin.username, password: admin.password },
    headers: { origin: baseUrl() },
  })
  const { csrfToken } = (await login.json()) as { csrfToken: string }
  const made = await writer.post('/api/v1/content', {
    data: { type: 'post', status: 'publish', title: secret },
    headers: { origin: baseUrl(), 'x-csrf-token': csrfToken },
  })
  expect(made.status()).toBe(201)
  await writer.dispose()
  await compose(['exec', '-T', 'api', 'toa', 'maintenance', 'on', '--message', message, '--retry-after', '120'])

  const request = await playwright.request.newContext({ baseURL: baseUrl() })
  try {
    const home = await request.get('/')
    expect(home.status()).toBe(503)
    expect(home.headers()['retry-after']).toBe('120')
    const html = await home.text()
    expect(html).toContain(message)
    // Nothing of the site's content is in the page or its payload (the address was never asked for).
    expect(html).not.toContain(secret)
    for (const path of ['/feed/', '/sitemap.xml', '/robots.txt']) {
      const answer = await request.get(path)
      expect(answer.status(), path).toBe(503)
      expect(answer.headers()['retry-after'], path).toBe('120')
    }
  } finally {
    await request.dispose()
  }

  // In the browser, as a visitor.
  await page.goto('/')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Kort utilgjengelig for planlagt vedlikehold' }),
  ).toBeVisible()
  await expect(page.getByText(message)).toBeVisible()
  await expect(page).toHaveTitle(/Kort utilgjengelig for planlagt vedlikehold/)
  await expectNoAxeViolations(page, 'the maintenance page')

  // An administrator signs in through the admin (the api answers) and sees the site, with the notice.
  await signIn(page, admin)
  await page.goto('/')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Kort utilgjengelig for planlagt vedlikehold' }),
  ).toHaveCount(0)
  await expect(page.getByText('Vedlikeholdsmodus er på: besøkende ser vedlikeholdssiden.')).toBeVisible()
  await expectNoAxeViolations(page, 'the site for an administrator in maintenance mode')

  // Off again: the visitor has the site back.
  await compose(['exec', '-T', 'api', 'toa', 'maintenance', 'off'])
  const after = await playwright.request.newContext({ baseURL: baseUrl() })
  expect((await after.get('/')).status()).toBe(200)
  await after.dispose()
})
