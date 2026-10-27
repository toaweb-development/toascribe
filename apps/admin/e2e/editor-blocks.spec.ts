import type { Page } from '@playwright/test'

import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { PHOTO_PNG } from './helpers/images.ts'
import { signIn } from './helpers/screens.ts'
import { PASSWORD, createUser } from './helpers/stack.ts'
import type { TestUser } from './helpers/stack.ts'

// The editor of M1.3: a post with every basic block (K-078, K-079) and the sidebar's featured image, categories, tags and excerpt; a
// post scheduled five minutes ahead that the worker publishes (K-063); a page under a parent; a block that keeps its component when
// it moves into a column, and a selection over several blocks copied, pasted into a column and cut, with undo and redo (decision
// note 0001); the login dialog when the session runs out (K-010); and a contributor, who can send for review but not publish. The
// fixture fails a test on any console message or CSP violation; axe runs on the editor, its dialogs and the preview.

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

let admin: TestUser
let contributor: TestUser

test.beforeAll(async () => {
  admin = await createUser('administrator', 'm13admin')
  contributor = await createUser('contributor', 'm13contrib')
})

/** A write to the api with the session's CSRF token, as the admin's own calls send it. */
async function api(page: Page, method: 'POST' | 'PATCH', path: string, data: unknown) {
  const session = (await (await page.request.get('/api/v1/auth/session')).json()) as { csrfToken: string }
  const answer = await page.request.fetch(`/api/v1${path}`, {
    method,
    data,
    headers: { 'X-CSRF-Token': session.csrfToken, origin: new URL(page.url()).origin },
  })
  expect(answer.ok(), await answer.text()).toBe(true)
  return (await answer.json()) as Record<string, unknown>
}

async function uploadImage(page: Page, name: string): Promise<string> {
  const session = (await (await page.request.get('/api/v1/auth/session')).json()) as { csrfToken: string }
  const answer = await page.request.post('/api/v1/media', {
    multipart: { file: { name: `${name}.png`, mimeType: 'image/png', buffer: PHOTO_PNG }, alt: `Bilde ${name}` },
    headers: { 'X-CSRF-Token': session.csrfToken, origin: new URL(page.url()).origin },
  })
  expect(answer.ok(), await answer.text()).toBe(true)
  return ((await answer.json()) as { id: string }).id
}

/** The «+» at the end of the document, and a block chosen by its name in the inserter. */
async function insertAtEnd(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Legg til blokk' }).last().click()
  const search = page.getByRole('searchbox', { name: 'Søk etter blokk' }).last()
  await search.fill(name)
  // In the inserter, not the toolbar's «Kode» (formatting) of the block that has the cursor.
  await page.getByRole('dialog').filter({ has: search }).getByRole('button', { name, exact: true }).click()
}

/** Chooses a file in the media picker by its name. */
async function pickFromLibrary(page: Page, word: string): Promise<void> {
  const picker = page.getByRole('dialog', { name: 'Velg eller last opp medier' })
  await picker.getByRole('searchbox').fill(word)
  await picker.getByRole('button', { name: 'Søk i media' }).click()
  await picker.getByRole('button', { name: word, exact: true }).first().click()
  await picker.getByRole('button', { name: 'Velg', exact: true }).click()
  await expect(picker).toBeHidden()
}

const unique = () => Date.now().toString(36).slice(-6)

test('a post with every basic block, a featured image, categories, tags and an excerpt', async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page, admin)
  const word = `m13alle${unique()}`
  await uploadImage(page, word)
  const category = (await api(page, 'POST', '/taxonomies/category/terms', { name: `Kategori ${word}` }))['id']

  await page.goto('/admin/posts/new')
  await page.getByRole('textbox', { name: 'Tittel', exact: true }).fill(`Alle blokker ${word}`)

  await insertAtEnd(page, 'Avsnitt')
  await page.keyboard.type('Et avsnitt.')
  await insertAtEnd(page, 'Overskrift')
  await page.keyboard.type('En overskrift')
  await insertAtEnd(page, 'Liste')
  await page.keyboard.type('Første punkt')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Underpunkt')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('textbox', { name: 'Listeelement' })).toHaveCount(2)
  await insertAtEnd(page, 'Sitat')
  await page.keyboard.type('Sitert tekst.')
  await insertAtEnd(page, 'Kode')
  await page.getByRole('textbox', { name: 'Kode', exact: true }).fill('if (a < b) return "<b>"')
  await insertAtEnd(page, 'Forhåndsformatert')
  await page.keyboard.type('Linje en')
  await page.keyboard.press('Enter')
  await page.keyboard.type('  linje to')
  await insertAtEnd(page, 'Tabell')
  await page.getByRole('textbox', { name: 'Rad 1, kolonne 1' }).click()
  await page.keyboard.type('By')
  await page.getByRole('textbox', { name: 'Rad 2, kolonne 1' }).click()
  await page.keyboard.type('<b>Bergen</b>')
  await insertAtEnd(page, 'Bilde')
  await page.getByRole('button', { name: 'Mediebibliotek' }).last().click()
  await pickFromLibrary(page, word)
  await insertAtEnd(page, 'Galleri')
  await page.getByRole('button', { name: 'Legg til bilde' }).click()
  await pickFromLibrary(page, word)
  await insertAtEnd(page, 'Knapper')
  await page.keyboard.type('Les mer om oss')
  await page.getByLabel('Lenkeadresse').last().fill('/om-oss')
  await insertAtEnd(page, 'Kolonner')
  await page.keyboard.type('I en kolonne')
  await insertAtEnd(page, 'Gruppe')
  await page.keyboard.type('I en gruppe')
  await insertAtEnd(page, 'Skillelinje')
  await insertAtEnd(page, 'Mellomrom')
  await insertAtEnd(page, 'Les mer')
  await insertAtEnd(page, 'Sideskift')
  await insertAtEnd(page, 'Egendefinert HTML')
  await page
    .getByRole('textbox', { name: 'Egendefinert HTML' })
    .fill('<p class="egen">Rå <script>alert(1)</script></p>')
  await expectNoAxeViolations(page, 'the editor with every basic block')

  // The sidebar: featured image, category, tags, excerpt.
  await page.getByRole('tab', { name: 'Innlegg' }).click()
  await page.getByRole('button', { name: 'Velg fremhevet bilde' }).click()
  await pickFromLibrary(page, word)
  await page.getByRole('checkbox', { name: `Kategori ${word}` }).check()
  await page.getByRole('textbox', { name: 'Stikkord', exact: true }).fill('tur, fjell')
  await page.getByRole('textbox', { name: 'Utdrag' }).fill('Et kort sammendrag.')
  await expectNoAxeViolations(page, 'the sidebar')

  await page.getByRole('button', { name: 'Lagre kladd' }).click()
  await expect(page.getByText('Lagret.').first()).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/posts\/[0-9a-f-]{36}$/)
  const id = page.url().split('/').pop() ?? ''

  const stored = (await (await page.request.get(`/api/v1/content/${id}`)).json()) as {
    featuredMediaId: string | null
    categories: { id: string }[]
    tags: { name: string }[]
    excerpt: string
    blocks: { type: string }[]
  }
  expect(stored.featuredMediaId).not.toBeNull()
  expect(stored.categories.map((term) => term.id)).toContain(category)
  expect(stored.tags.map((term) => term.name)).toEqual(['tur', 'fjell'])
  expect(stored.excerpt).toBe('Et kort sammendrag.')
  expect(stored.blocks.map((block) => block.type)).toEqual([
    'core/paragraph',
    'core/heading',
    'core/list',
    'core/quote',
    'core/code',
    'core/preformatted',
    'core/table',
    'core/image',
    'core/gallery',
    'core/buttons',
    'core/columns',
    'core/group',
    'core/separator',
    'core/spacer',
    'core/more',
    'core/nextpage',
    'core/html',
  ])

  // The preview from the server: every block as HTML, markup in the data as text, and the custom HTML as its source.
  const html = (await (await page.request.get(`/admin/preview/${id}`)).text()).replace(/<!--[\s\S]*?-->/g, '')
  for (const part of [
    /<h2>En overskrift<\/h2>/,
    /<ul class="block-list"><li>Første punkt<ul class="block-list"><li>Underpunkt<\/li><\/ul><\/li><\/ul>/,
    /<blockquote class="block-quote"><p>Sitert tekst\.<\/p>/,
    /<pre class="block-code"><code>if \(a &lt; b\) return &quot;&lt;b&gt;&quot;<\/code><\/pre>/,
    /<th scope="col">By<\/th>/,
    /<td>&lt;b&gt;Bergen&lt;\/b&gt;<\/td>/,
    /<figure class="block-gallery columns-3 is-cropped">/,
    /<a class="block-button is-fill" href="\/om-oss">Les mer om oss<\/a>/,
    /<hr class="block-separator">/,
    /<pre class="block-html is-source"><code>&lt;p class=&quot;egen&quot;&gt;Rå &lt;script&gt;/,
  ]) {
    expect(html).toMatch(part)
  }
  expect(html).not.toContain('<script>alert(1)')
  await page.goto(`/admin/preview/${id}`)
  await expectNoAxeViolations(page, 'the preview of every basic block')
})

test('an editor is not offered custom HTML, and a contributor sends for review instead of publishing', async ({
  page,
}) => {
  await signIn(page, contributor)
  await page.goto('/admin/posts/new')
  await page.getByRole('button', { name: 'Legg til blokk' }).last().click()
  await page.getByRole('searchbox', { name: 'Søk etter blokk' }).fill('HTML')
  await expect(page.getByRole('button', { name: 'Egendefinert HTML', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Send til gjennomgang' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publiser', exact: true })).toHaveCount(0)
  await expect(page.getByText('Velg tidspunkt for publisering')).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Tittel', exact: true }).fill(`Til gjennomgang ${unique()}`)
  await page.getByRole('button', { name: 'Send til gjennomgang' }).click()
  await expect(page.getByText('Sendt til gjennomgang.').first()).toBeVisible()
  await expect(page.getByText('Status: Venter på gjennomgang')).toBeVisible()
})

test('a post scheduled five minutes ahead is published by the worker', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1280', 'one run is enough: it waits for the worker')
  test.setTimeout(9 * 60_000)
  await signIn(page, admin)
  await page.goto('/admin/posts/new')
  const title = `Planlagt ${unique()}`
  await page.getByRole('textbox', { name: 'Tittel', exact: true }).fill(title)
  await page.getByRole('tab', { name: 'Innlegg' }).click()
  await page.getByRole('switch', { name: 'Velg tidspunkt for publisering' }).click()
  const at = new Date(Date.now() + 5 * 60_000)
  const pad = (value: number) => String(value).padStart(2, '0')
  const local = `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
  await page.getByLabel('Publiser', { exact: true }).fill(local)
  await expect(page.getByRole('button', { name: 'Planlegg' })).toBeVisible()
  await page.getByRole('button', { name: 'Planlegg' }).click()
  await expect(page.getByText('Planlagt.').first()).toBeVisible()
  // The new post gets its own address after the save; read the id from it once it is there.
  await expect(page).toHaveURL(/\/admin\/posts\/[0-9a-f-]{36}$/)
  const id = page.url().split('/').pop() ?? ''
  const statusOf = async () =>
    ((await (await page.request.get(`/api/v1/content/${id}`)).json()) as { status: string }).status
  expect(await statusOf()).toBe('future')
  // The worker's scheduler runs every minute: the post is published within a minute or two of its time.
  await expect.poll(statusOf, { timeout: 8 * 60_000, intervals: [15_000] }).toBe('publish')
})

test('a page under a parent page, from the sidebar', async ({ page }) => {
  await signIn(page, admin)
  const word = unique()
  const parent = (await api(page, 'POST', '/content', { type: 'page', title: `Forelder ${word}`, status: 'publish' }))[
    'id'
  ]
  await page.goto('/admin/pages/new')
  await page.getByRole('textbox', { name: 'Tittel', exact: true }).fill(`Underside ${word}`)
  await page.getByRole('tab', { name: 'Side' }).click()
  await page.getByRole('combobox', { name: 'Forelder' }).click()
  await page.getByRole('option', { name: `Forelder ${word}` }).click()
  await page.getByRole('button', { name: 'Lagre kladd' }).click()
  await expect(page.getByText('Lagret.').first()).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/pages\/[0-9a-f-]{36}$/)
  const id = page.url().split('/').pop() ?? ''
  const stored = (await (await page.request.get(`/api/v1/content/${id}`)).json()) as { parentId: string | null }
  expect(stored.parentId).toBe(parent)
})

test('a block keeps its component when it moves into a column; several blocks are copied, pasted into a column and cut', async ({
  page,
}) => {
  await signIn(page, admin)
  await page.goto('/admin/posts/new')
  await insertAtEnd(page, 'Avsnitt')
  await page.keyboard.type('Første')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Andre')
  await insertAtEnd(page, 'Kolonner')
  await page.keyboard.type('Kolonnetekst')

  // Mark the TipTap element of «Andre», move the block into the first column, and find the same element there.
  const second = page.getByRole('textbox', { name: 'Avsnitt' }).filter({ hasText: 'Andre' })
  await second.click()
  await second.evaluate((element) => {
    element.setAttribute('data-test-marker', 'samme')
  })
  await page.keyboard.press('Alt+Shift+ArrowDown')
  const column = page.getByRole('group', { name: 'Kolonne 1' })
  await expect(column.locator('[data-test-marker="samme"]')).toHaveText('Andre')
  await expect(column.locator('[data-test-marker="samme"]')).toBeFocused()
  await page.keyboard.press(`${MOD}+z`)
  await expect(page.locator('[data-test-marker="samme"]')).toHaveCount(1)
  await expect(column.locator('[data-test-marker="samme"]')).toHaveCount(0)

  // A selection of the two paragraphs: Shift+click.
  await page.getByRole('textbox', { name: 'Avsnitt' }).filter({ hasText: 'Første' }).click()
  await page
    .getByRole('textbox', { name: 'Avsnitt' })
    .filter({ hasText: 'Andre' })
    .click({ modifiers: ['Shift'] })
  await expect(page.getByText('2 blokker er valgt.').first()).toBeAttached()
  await expectNoAxeViolations(page, 'a selection over two blocks')

  // Copy (a clipboard event, as the browser sends for Ctrl+C), then paste into the column's paragraph: two blocks after it.
  const canvas = page.locator('[data-editor-canvas]')
  const copied = await canvas.evaluate((element) => {
    const data = new DataTransfer()
    element.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }))
    return { json: data.getData('application/x-toascribe-blocks'), text: data.getData('text/plain') }
  })
  expect(copied.text).toBe('Første\n\nAndre')
  await column.getByRole('textbox', { name: 'Avsnitt' }).click()
  await column.getByRole('textbox', { name: 'Avsnitt' }).evaluate((element, json) => {
    const data = new DataTransfer()
    data.setData('application/x-toascribe-blocks', json)
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, copied.json)
  await expect(column.getByRole('textbox', { name: 'Avsnitt' })).toHaveCount(3)
  await expect(column.getByRole('textbox', { name: 'Avsnitt' }).nth(2)).toHaveText('Andre')
  await page.keyboard.press(`${MOD}+z`)
  await expect(column.getByRole('textbox', { name: 'Avsnitt' })).toHaveCount(1)
  await page.keyboard.press(`${MOD}+Shift+z`)
  await expect(column.getByRole('textbox', { name: 'Avsnitt' })).toHaveCount(3)

  // Plain text of two paragraphs pasted: two paragraphs.
  await column.getByRole('textbox', { name: 'Avsnitt' }).first().click()
  await column
    .getByRole('textbox', { name: 'Avsnitt' })
    .first()
    .evaluate((element) => {
      const data = new DataTransfer()
      data.setData('text/plain', 'Limt inn en\n\nLimt inn to')
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    })
  await expect(column.getByRole('textbox', { name: 'Avsnitt' })).toHaveCount(5)

  // Cut the two top-level paragraphs: they go, and undo brings them back.
  await page.getByRole('textbox', { name: 'Avsnitt' }).filter({ hasText: 'Første' }).first().click()
  await page
    .getByRole('textbox', { name: 'Avsnitt' })
    .filter({ hasText: 'Andre' })
    .first()
    .click({ modifiers: ['Shift'] })
  await canvas.evaluate((element) => {
    element.dispatchEvent(
      new ClipboardEvent('cut', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true }),
    )
  })
  await expect(page.getByRole('textbox', { name: 'Avsnitt' }).filter({ hasText: 'Første' })).toHaveCount(1)
  await page.keyboard.press(`${MOD}+z`)
  await expect(page.getByRole('textbox', { name: 'Avsnitt' }).filter({ hasText: 'Første' })).toHaveCount(2)
})

test('the session runs out while editing: a login dialog, and nothing written is lost', async ({
  page,
  context,
  allowFailedRequests,
}) => {
  // The save that finds the session gone is a 401 on purpose, and the browser logs it.
  allowFailedRequests()
  const user = await createUser('author', 'm13login')
  await signIn(page, user)
  await page.goto('/admin/posts/new')
  const title = `Ikke tapt ${unique()}`
  await page.getByRole('textbox', { name: 'Tittel', exact: true }).fill(title)
  await insertAtEnd(page, 'Avsnitt')
  await page.keyboard.type('Tekst som ikke skal bli borte.')

  // The session ends behind the editor's back (another tab logged out, or it expired).
  await context.clearCookies()
  // «Forhåndsvis» first: the login dialog in the editor, and no tab left behind with a login screen or nothing in it.
  await page.getByRole('button', { name: 'Forhåndsvis' }).click()
  const dialog = page.getByRole('dialog', { name: 'Økten er utløpt' })
  await expect(dialog).toBeVisible()
  await expect.poll(() => context.pages().length).toBe(1)
  await dialog.getByRole('button', { name: 'Senere' }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: 'Lagre kladd' }).click()
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/posts\/new$/)
  await expectNoAxeViolations(page, 'the login dialog over the editor')
  // «Senere»: the editor is still there with the text, and the next save asks again.
  await dialog.getByRole('button', { name: 'Senere' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('textbox', { name: 'Avsnitt' })).toHaveText('Tekst som ikke skal bli borte.')
  await page.getByRole('button', { name: 'Lagre kladd' }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Brukernavn eller e-postadresse').fill(user.username)
  await dialog.getByLabel('Passord', { exact: true }).fill(PASSWORD)
  await dialog.getByRole('button', { name: 'Logg inn' }).click()
  await expect(dialog).toBeHidden()
  // The save that found the session gone goes on by itself (and the dismissed preview is not asked for again).
  await expect(page.getByText('Du er logget inn igjen.').first()).toBeVisible()
  await expect(page.getByText('Velg «Forhåndsvis» en gang til.')).toHaveCount(0)
  await expect(page.getByText('Lagret.').first()).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/posts\/[0-9a-f-]{36}$/)
  const id = page.url().split('/').pop() ?? ''
  const stored = (await (await page.request.get(`/api/v1/content/${id}`)).json()) as {
    title: string
    blocks: unknown[]
  }
  expect(stored.title).toBe(title)
  expect(JSON.stringify(stored.blocks)).toContain('Tekst som ikke skal bli borte.')
})
