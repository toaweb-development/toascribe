import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { compose, createUser, queryRows, runSql, setSetting, uniqueName } from './helpers/stack.ts'
import type { TestUser } from './helpers/stack.ts'

// The default theme as Tor saw it in 0.7.0 (M2.1, part A). The site has one palette (theme.json and «Tilpass») and no light/dark
// switch, so a reader whose system is dark gets the same readable page: the site's title, the post's title and the embed's notice
// were light on light before. Each check runs in both colour schemes, at 375 px and 1280 px, with axe.

const VIDEO = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'
const SITE_TITLE = 'TestSite'
let author: TestUser
let path = ''

test.beforeAll(async () => {
  author = await createUser('author', 'temaforfatter')
  // The provider's answer as the server keeps it: the stack's containers may not reach YouTube.
  const data = JSON.stringify({
    provider: 'youtube',
    title: 'Big Buck Bunny',
    authorName: 'Blender',
    frameSrc: 'https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ',
    width: 200,
    height: 113,
    thumbnailUrl: null,
    thumbnailId: null,
  })
  await runSql(
    `insert into oembed_cache (url, data, expires_at) values ('${VIDEO}', '${data}'::jsonb, now() + interval '1 day')
     on conflict (url) do update set data = excluded.data, expires_at = excluded.expires_at`,
  )
  const title = uniqueName('Temainnlegg')
  const blocks = [
    {
      id: 'b_head0001',
      type: 'core/heading',
      version: 1,
      attrs: { level: 2, content: [{ type: 'text', text: 'Mellomtittel' }] },
      children: [],
    },
    {
      id: 'b_para0001',
      type: 'core/paragraph',
      version: 1,
      attrs: { content: [{ type: 'text', text: 'Tekst før videoen.' }] },
      children: [],
    },
    { id: 'b_embd0001', type: 'core/embed', version: 1, attrs: { url: VIDEO }, children: [] },
  ]
  const made = await compose([
    'exec',
    '-T',
    'api',
    'toa',
    'post',
    'create',
    '--title',
    title,
    '--status',
    'publish',
    '--blocks',
    JSON.stringify(blocks),
    '--user',
    author.username,
  ])
  const id = /[0-9a-f-]{36}/.exec(made)?.[0] ?? ''
  // The short link: the site sends it on to the post's address, whatever the permalink structure is.
  const [shortId] = await queryRows(`select short_id from content where id = '${id}'`)
  path = `/?p=${shortId ?? ''}`
  await setSetting('embed_click_to_load', true)
  await setSetting('blogname', SITE_TITLE)
})

test.afterAll(async () => {
  await setSetting('blogname', '')
})

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`with the system ${colorScheme}`, () => {
    test.use({ colorScheme })

    test('the site has no dark switch: the titles, the meta line and the waiting embed read well', async ({ page }) => {
      await page.goto(path)
      await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)

      // 4: the site's title in the header, not only the search.
      const banner = page.getByRole('banner')
      await expect(banner.getByRole('link', { name: SITE_TITLE })).toBeVisible()

      // 1: a space before the author and the category.
      const meta = page.locator('.theme-meta')
      await expect(meta).toContainText(`av ${author.username}`)
      await expect(meta).toContainText('i Ukategorisert')

      // 3: the post starts right under the header, with its title visible.
      const title = page.getByRole('heading', { level: 1 })
      await expect(title).toBeVisible()
      const bannerBox = await banner.boundingBox()
      const titleBox = await title.boundingBox()
      expect((titleBox?.y ?? 0) - ((bannerBox?.y ?? 0) + (bannerBox?.height ?? 0))).toBeLessThan(80)

      // 5: the post's title is clearly larger than a heading in its text.
      const size = (selector: string) =>
        page
          .locator(selector)
          .first()
          .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
      expect(await size('h1')).toBeGreaterThanOrEqual(1.4 * (await size('.blocks h2')))

      // 2: the embed waiting for a click: its notice and its link read well (axe checks the contrast of both).
      const embed = page.locator('figure.scribe-embed')
      await expect(embed.getByText('Innholdet lastes fra YouTube.', { exact: false })).toBeVisible()
      await expect(embed.getByRole('link', { name: 'Åpne hos YouTube' })).toBeVisible()
      await expect(embed.locator('iframe')).toHaveCount(0)
      await expectNoAxeViolations(page, `a post with a waiting embed, system ${colorScheme}`)
    })
  })
}
