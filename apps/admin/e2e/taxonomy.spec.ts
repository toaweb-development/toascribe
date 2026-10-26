import type { Page } from '@playwright/test'

import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { signIn } from './helpers/screens.ts'
import { createUser } from './helpers/stack.ts'
import type { TestUser } from './helpers/stack.ts'

// Categories and tags (M1.2): a category and a tag made on their screens, given to a post in quick edit, and the post list filtered by
// a click on the category in the row. Each test runs at 375 px and 1280 px; the fixture fails a test on any console message or CSP
// violation, and axe runs on both screens and the dialog. Names carry a word of this run, as other specs share the database.

let editor: TestUser

test.beforeAll(async () => {
  editor = await createUser('editor', 'terms')
})

function tag(page: Page, name: string): string {
  const width = page.viewportSize()?.width ?? 0
  return `e2e${name}${String(width)}${Date.now().toString(36).slice(-5)}`
}

test('make a category and a tag, put them on a post in quick edit, and filter the list by the category', async ({
  page,
}) => {
  await signIn(page, editor)
  const word = tag(page, 'term')
  const category = `Kat ${word}`
  const label = `stikk${word}`

  await page.goto('/admin/categories')
  await expect(page.getByRole('heading', { level: 1, name: 'Kategorier' })).toBeVisible()
  await page.getByLabel('Navn', { exact: true }).fill(category)
  await page.getByRole('button', { name: 'Legg til ny kategori' }).click()
  await expect(page.getByText('Kategori lagt til.')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Kategoriliste' }).getByText(category, { exact: true })).toBeVisible()
  await expectNoAxeViolations(page, 'the categories screen')

  await page.goto('/admin/tags')
  await expect(page.getByRole('heading', { level: 1, name: 'Stikkord' })).toBeVisible()
  await page.getByLabel('Navn', { exact: true }).fill(label)
  await page.getByRole('button', { name: 'Legg til stikkord' }).click()
  await expect(page.getByText('Stikkord lagt til.')).toBeVisible()
  await expectNoAxeViolations(page, 'the tags screen')

  // A post, made through the API as the signed-in page.
  const session = (await (await page.request.get('/api/v1/auth/session')).json()) as { csrfToken: string }
  const made = await page.request.post('/api/v1/content', {
    headers: { 'X-CSRF-Token': session.csrfToken, origin: new URL(page.url()).origin },
    data: { type: 'post', title: `${word} Innlegg` },
  })
  expect(made.ok(), await made.text()).toBe(true)

  await page.goto(`/admin/posts?search=${encodeURIComponent(word)}`)
  await page
    .getByRole('button', { name: `Hurtigrediger «${word} Innlegg»` })
    .filter({ visible: true })
    .first()
    .click()
  const dialog = page.getByRole('dialog', { name: 'Hurtigrediger' })
  await dialog.getByRole('checkbox', { name: category }).check()
  await dialog.getByLabel('Stikkord').fill(label)
  await expectNoAxeViolations(page, 'quick edit with categories and tags')
  await dialog.getByRole('button', { name: 'Oppdater' }).click()
  await expect(dialog).toBeHidden()

  // The row shows the category and the tag as links to the list filtered by them.
  const categoryLink = page.getByRole('link', { name: category, exact: true }).filter({ visible: true }).first()
  await expect(categoryLink).toBeVisible()
  await expect(page.getByRole('link', { name: label, exact: true }).filter({ visible: true }).first()).toBeVisible()
  await categoryLink.click()
  await expect(page).toHaveURL(/[?&]category=[0-9a-f-]{36}/)
  await expect(page.getByText(`${word} Innlegg`).filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByText('1 element').filter({ visible: true }).first()).toBeVisible()
})
