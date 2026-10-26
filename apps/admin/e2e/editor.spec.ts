import type { Page } from '@playwright/test'

import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { PNG } from './helpers/images.ts'
import { signIn } from './helpers/screens.ts'
import { createUser } from './helpers/stack.ts'
import type { TestUser } from './helpers/stack.ts'

// The block editor (M0.6's prototype, on a real post since M1.1): a document with two columns, an image and paragraphs, formatting, a
// move into a column, undo and redo across all of it, save (the new post gets its own address), reload, and the server-rendered preview
// of the same JSON. Each test runs at 375 px and 1280 px;
// the fixture fails a test on any console message or CSP violation, and axe runs on the editor and on the preview.

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

let editorUser: TestUser

test.beforeAll(async () => {
  editorUser = await createUser('editor', 'blockeditor')
})

/**
 * Waits a frame. ProseMirror reads a selection made with the keyboard from the browser's `selectionchange`, which arrives as a task
 * of its own; Playwright presses the next key before that task has run, faster than a person can.
 */
const settle = (page: Page) =>
  page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))))

const paragraphs = (page: Page) => page.getByRole('textbox', { name: 'Avsnitt' })

/** The document's shape as the editor shows it: each block's type, with the blocks of each column inside. */
async function outline(page: Page): Promise<string> {
  return page.getByRole('region', { name: 'Innhold' }).evaluate((root) => {
    const describe = (element: Element): string => {
      const type = element.getAttribute('data-block-type') ?? ''
      const inner = [...element.querySelectorAll(':scope [data-block-id]')]
        .filter((child) => child.parentElement?.closest('[data-block-id]') === element)
        .map(describe)
      const short = type.replace('core/', '')
      return inner.length > 0 ? `${short}(${inner.join(' ')})` : short
    }
    return [...root.querySelectorAll('[data-block-id]')]
      .filter((element) => element.parentElement?.closest('[data-block-id]') === null)
      .map(describe)
      .join(' ')
  })
}

test('build a document with columns, an image and formatted text; undo and redo; save, reload and preview', async ({
  page,
}) => {
  await signIn(page, editorUser)
  await page.goto('/admin/posts/new')
  await expect(page.getByRole('heading', { level: 1, name: 'Legg til innlegg' })).toBeVisible()
  await expect(page.getByText('Dokumentet er tomt.')).toBeVisible()

  // Columns from the «+» at the end of the document: two columns, each with an empty paragraph, and the cursor in the first.
  await page.getByRole('button', { name: 'Legg til blokk' }).last().click()
  await page.getByRole('menuitem', { name: 'Kolonner' }).click()
  await expect(page.getByRole('group', { name: 'Kolonne 2' })).toBeVisible()
  await expect(paragraphs(page).first()).toBeFocused()
  await page.keyboard.type('Venstre kolonne')

  // An image in the second column through the «/» menu: the library opens, a file uploaded there is chosen as it arrives.
  const second = page.getByRole('group', { name: 'Kolonne 2' })
  await second.getByRole('textbox', { name: 'Avsnitt' }).click()
  await page.keyboard.type('/bil')
  const listbox = page.getByRole('listbox', { name: 'Velg blokk' })
  await expect(listbox.getByRole('option', { name: 'Bilde' })).toHaveAttribute('aria-selected', 'true')
  await expectNoAxeViolations(page, 'the editor with the «/» menu open')
  await page.keyboard.press('Enter')
  await second.getByRole('button', { name: 'Mediebibliotek' }).click()
  const picker = page.getByRole('dialog', { name: 'Velg eller last opp medier' })
  await picker.getByRole('button', { name: 'Legg til mediefil' }).click()
  await expect(picker.getByText(/Maksimal filstørrelse for opplasting: \d+ MB\./)).toBeVisible()
  await picker.locator('input[type="file"]').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: PNG })
  await expect(picker.getByRole('status').filter({ hasText: 'Valgt:' })).toBeVisible()
  await expectNoAxeViolations(page, 'the image picker with an upload')
  await picker.getByRole('button', { name: 'Velg', exact: true }).click()
  // Without alt text the image is decorative (no `img` role); with it, it is named by it.
  await expect(second.getByLabel('Alternativ tekst')).toBeFocused()
  await second.getByLabel('Alternativ tekst').fill('Et testbilde')
  await expect(second.getByRole('img', { name: 'Et testbilde' })).toBeVisible()

  // A paragraph after the columns, with text typed in one go and one word made bold afterwards.
  await page.getByRole('button', { name: 'Legg til blokk' }).last().click()
  await page.getByRole('menuitem', { name: 'Avsnitt' }).click()
  const last = paragraphs(page).last()
  await expect(last).toBeFocused()
  await page.keyboard.type('Hei fet tekst')
  for (let step = 0; step < ' tekst'.length; step += 1) await page.keyboard.press('ArrowLeft')
  for (let step = 0; step < 'fet'.length; step += 1) await page.keyboard.press('Shift+ArrowLeft')
  await settle(page)
  await page.keyboard.press(`${MOD}+b`)
  await expect(last.locator('strong')).toHaveText('fet')
  await expect(page.getByRole('button', { name: 'Fet' })).toHaveAttribute('aria-pressed', 'true')
  await expectNoAxeViolations(page, 'the editor with columns, an image and a paragraph')

  // Move the paragraph up: it goes into the end of the second column, after the image.
  expect(await outline(page)).toBe('columns(column(paragraph) column(image)) paragraph')
  await page.keyboard.press('Alt+Shift+ArrowUp')
  expect(await outline(page)).toBe('columns(column(paragraph) column(image paragraph))')
  await expect(second.getByRole('textbox', { name: 'Avsnitt' })).toBeFocused()

  // Undo three times: the move, the bold, the typing. Redo twice: the typing and the bold, not the move.
  await page.keyboard.press(`${MOD}+z`)
  expect(await outline(page)).toBe('columns(column(paragraph) column(image)) paragraph')
  await page.keyboard.press(`${MOD}+z`)
  await expect(last.locator('strong')).toHaveCount(0)
  await expect(last).toHaveText('Hei fet tekst')
  await page.keyboard.press(`${MOD}+z`)
  await expect(last).toHaveText('')
  await page.keyboard.press(`${MOD}+Shift+z`)
  await expect(last).toHaveText('Hei fet tekst')
  await page.getByRole('button', { name: 'Gjør om' }).click()
  await expect(last.locator('strong')).toHaveText('fet')
  expect(await outline(page)).toBe('columns(column(paragraph) column(image)) paragraph')
  // One step is left to redo: the move.
  await expect(page.getByRole('button', { name: 'Gjør om' })).toBeEnabled()

  // Save, reload: the same document.
  await page.getByRole('button', { name: 'Lagre kladd' }).click()
  await expect(page.getByText('Lagret.').first()).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/posts\/[0-9a-f-]{36}$/)
  const id = page.url().split('/').pop() ?? ''
  await page.reload()
  await expect(paragraphs(page).first()).toHaveText('Venstre kolonne')
  await expect(page.getByRole('group', { name: 'Kolonne 2' }).getByRole('img', { name: 'Et testbilde' })).toBeVisible()
  await expect(paragraphs(page).last().locator('strong')).toHaveText('fet')
  expect(await outline(page)).toBe('columns(column(paragraph) column(image)) paragraph')

  // The preview: the same JSON as HTML from the server, before any script runs, with the same text and markup.
  const answer = await page.request.get(`/admin/preview/${id}`)
  expect(answer.status()).toBe(200)
  const html = await answer.text()
  // Vue's hydration markers (<!--[-->) are comments; without them the markup is what the view wrote.
  const article = (
    /<article[^>]*data-testid="content-preview"[^>]*>([\s\S]*?)<\/article>/.exec(html)?.[1] ?? ''
  ).replace(/<!--[\s\S]*?-->/g, '')
  expect(article).toContain('Venstre kolonne')
  expect(article).toMatch(/<p[^>]*>Hei <strong>fet<\/strong> tekst<\/p>/)
  // The file's address in the library, with a srcset from its sizes.
  expect(article).toMatch(/<img[^>]*src="\/uploads\/\d{4}\/\d{2}\/test-[0-9a-f]{8}\.png"[^>]*srcset="[^"]+ 1w"/)
  expect(article).toMatch(/<img[^>]*alt="Et testbilde"/)
  expect(article).not.toMatch(/<script|\son[a-z]+=/)

  await page.goto(`/admin/preview/${id}`)
  const preview = page.getByTestId('content-preview')
  await expect(preview.getByRole('img', { name: 'Et testbilde' })).toBeVisible()
  await expect(preview.locator('strong')).toHaveText('fet')
  await expectNoAxeViolations(page, 'the preview')
})

test('keyboard only: Enter makes a paragraph, Backspace in an empty one deletes it, and the toolbar moves and deletes', async ({
  page,
}) => {
  const user = await createUser('author', 'blockkeys')
  await signIn(page, user)
  await page.goto('/admin/posts/new')
  await page.getByRole('button', { name: 'Legg til blokk' }).last().focus()
  await page.keyboard.press('Enter')
  await page.getByRole('menuitem', { name: 'Avsnitt' }).press('Enter')
  await expect(paragraphs(page)).toHaveCount(1)
  await page.keyboard.type('En')
  await page.keyboard.press('Enter')
  await page.keyboard.type('To')
  await page.keyboard.press('Enter')
  await expect(paragraphs(page)).toHaveCount(3)
  await expect(paragraphs(page).nth(2)).toBeFocused()
  await page.keyboard.press('Backspace')
  await expect(paragraphs(page)).toHaveCount(2)
  await expect(paragraphs(page).nth(1)).toBeFocused()

  // Visible focus: the block that has the cursor carries the ring, and its toolbar is there.
  const tools = page.getByRole('toolbar', { name: 'Blokkverktøy for Avsnitt' })
  await expect(tools).toHaveCount(1)
  await tools.getByRole('button', { name: 'Flytt opp' }).click()
  await expect(paragraphs(page).first()).toHaveText('To')
  await page.keyboard.press(`${MOD}+z`)
  await expect(paragraphs(page).first()).toHaveText('En')
  await paragraphs(page).first().click()
  await page.keyboard.press('Alt+Shift+z')
  await expect(paragraphs(page)).toHaveCount(1)
  await expect(paragraphs(page).first()).toHaveText('To')
  await expectNoAxeViolations(page, 'the editor after keyboard edits')
})

test('the editor lets images in from this site only, like every other admin page (M1.1)', async ({ page }) => {
  await signIn(page, editorUser)
  const csp = (await page.request.get('/admin/posts/new')).headers()['content-security-policy'] ?? ''
  expect(csp).toMatch(/img-src 'self' data:(;|$)/)
  expect(csp).toContain("default-src 'none'")
  expect(csp).not.toContain('unsafe-inline')
  // The image block takes a file of the media library only: no field for an address on another host.
  await page.goto('/admin/posts/new')
  await page.getByRole('button', { name: 'Legg til blokk' }).last().click()
  await page.getByRole('menuitem', { name: 'Bilde' }).click()
  await expect(page.getByRole('button', { name: 'Mediebibliotek' })).toBeVisible()
  await expect(page.getByLabel('Bildeadresse')).toHaveCount(0)
})
