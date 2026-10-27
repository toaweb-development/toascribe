import type { Page } from '@playwright/test'

import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { signIn } from './helpers/screens.ts'
import { createUser, runSql, uniqueName } from './helpers/stack.ts'
import type { TestUser } from './helpers/stack.ts'

// «Innbygging» (M1.6, K-225): a YouTube link pasted alone into a paragraph becomes an embed; saved, the server sets its player; on
// the site it waits behind «Klikk for å laste», and nothing is asked of YouTube until the reader clicks. Then the player comes, from
// youtube-nocookie.com, allowed by the site's frame-src (the fixture fails on any CSP violation). 375 px and 1280 px, with axe.
//
// The stack's containers may not reach YouTube (a test never depends on the network): the provider's answer is put in
// `oembed_cache` first, as the server would have kept it, and the player's address is answered in the browser.

const VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const PLAYER = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'
let admin: TestUser

test.beforeAll(async () => {
  admin = await createUser('administrator', 'embedadmin')
  const data = JSON.stringify({
    provider: 'youtube',
    title: 'Never Gonna Give You Up',
    authorName: 'Rick Astley',
    frameSrc: PLAYER,
    width: 200,
    height: 113,
    thumbnailUrl: null,
    thumbnailId: null,
  })
  await runSql(
    `insert into oembed_cache (url, data, expires_at) values ('${VIDEO}', '${data}'::jsonb, now() + interval '1 day')
     on conflict (url) do update set data = excluded.data, expires_at = excluded.expires_at`,
  )
})

test('a pasted YouTube link is embedded, and the site loads it only after a click', async ({ page }) => {
  const title = uniqueName('Innbygd')
  await signIn(page, admin)
  await page.goto('/admin/posts/new')
  await page.getByRole('textbox', { name: 'Tittel', exact: true }).fill(title)
  await page.getByRole('button', { name: 'Legg til blokk' }).last().click()
  const search = page.getByRole('searchbox', { name: 'Søk etter blokk' }).last()
  await search.fill('Avsnitt')
  await page.getByRole('dialog').filter({ has: search }).getByRole('button', { name: 'Avsnitt', exact: true }).click()
  const paragraph = page.getByRole('textbox', { name: 'Avsnitt' }).last()
  await paragraph.click()
  await paragraph.evaluate((element, url) => {
    const data = new DataTransfer()
    data.setData('text/plain', url)
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, VIDEO)
  const block = page.getByRole('group', { name: 'Innbygging', exact: true })
  await expect(block).toBeVisible()
  await block.getByRole('button', { name: 'Bygg inn' }).click()
  await expect(block.getByText('Fra YouTube: Never Gonna Give You Up')).toBeVisible()
  await expectNoAxeViolations(page, 'the editor with an embed')

  await page.getByRole('button', { name: 'Lagre kladd' }).click()
  await expect(page.getByText('Lagret.').first()).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/posts\/[0-9a-f-]{36}$/)
  const id = page.url().split('/').pop() ?? ''
  const publish = await page.request.post(`/api/v1/content/${id}/publish`, {
    headers: { origin: new URL(page.url()).origin, 'x-csrf-token': await csrfToken(page) },
  })
  expect(publish.status(), await publish.text()).toBe(200)
  const stored = (await (await page.request.get(`/api/v1/content/${id}`)).json()) as {
    shortLink: string
    blocks: { type: string; attrs: Record<string, unknown> }[]
  }
  expect(stored.blocks.find((entry) => entry.type === 'core/embed')?.attrs).toMatchObject({
    provider: 'youtube',
    frameSrc: PLAYER,
  })

  // The site: nothing from YouTube until the click.
  const fromYouTube: string[] = []
  page.on('request', (request) => {
    if (/youtube|ytimg|googlevideo/.test(new URL(request.url()).hostname)) fromYouTube.push(request.url())
  })
  await page.route(`${PLAYER}**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Spiller</title><p>Spiller</p>',
    }),
  )
  // The short link: the site sends it on to the post's address.
  await page.goto(stored.shortLink)
  const embed = page.locator('figure.scribe-embed')
  await expect(embed.getByText('Innholdet lastes fra YouTube.', { exact: false })).toBeVisible()
  await expect(embed.locator('iframe')).toHaveCount(0)
  await expect(embed.getByRole('link', { name: 'Åpne hos YouTube' })).toHaveAttribute('href', VIDEO)
  await expectNoAxeViolations(page, 'the site with an embed waiting for a click')
  expect(fromYouTube).toEqual([])

  await embed.getByRole('button', { name: 'Last inn fra YouTube' }).click()
  const frame = embed.locator('iframe')
  await expect(frame).toHaveAttribute('src', PLAYER)
  await expect(frame).toHaveAttribute('title', 'Never Gonna Give You Up')
  await expect(page.frameLocator('figure.scribe-embed iframe').getByText('Spiller')).toBeVisible()
  expect(fromYouTube.every((url) => url.startsWith(PLAYER))).toBe(true)
})

/** The CSRF token of the signed-in page, as the admin's API layer sends it. */
async function csrfToken(page: Page): Promise<string> {
  const session = await page.request.get('/api/v1/auth/session')
  return ((await session.json()) as { csrfToken?: string }).csrfToken ?? ''
}
