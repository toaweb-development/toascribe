import type { Page } from '@playwright/test'

import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { signIn } from './helpers/screens.ts'
import { createUser } from './helpers/stack.ts'
import type { TestUser } from './helpers/stack.ts'

// Posts and pages (M1.1): a post made in the editor and saved as a draft, then quick edit, publish, the trash and back, a bulk action,
// and a page under another page. Each test runs at 375 px (a list) and at 1280 px (a table); the fixture fails a test on any console
// message or CSP violation, and axe runs on the lists and the dialogs. Other specs share the database, so every title starts with a
// word of this run and the lists are narrowed to it with the search.

let editor: TestUser

test.beforeAll(async () => {
  editor = await createUser('editor', 'content')
})

/** A word no other run has, for the titles of one test at one width. */
function tag(page: Page, name: string): string {
  const width = page.viewportSize()?.width ?? 0
  return `e2e${name}${String(width)}${Date.now().toString(36).slice(-5)}`
}

/** Makes items through the API, as the signed-in page (session cookie and CSRF token). */
async function makeItem(page: Page, body: Record<string, unknown>): Promise<string> {
  const session = (await (await page.request.get('/api/v1/auth/session')).json()) as { csrfToken: string }
  const answer = await page.request.post('/api/v1/content', {
    headers: { 'X-CSRF-Token': session.csrfToken, origin: new URL(page.url()).origin },
    data: body,
  })
  expect(answer.ok(), await answer.text()).toBe(true)
  return ((await answer.json()) as { id: string }).id
}

async function openList(page: Page, path: string, search: string): Promise<void> {
  await page.goto(`/admin/${path}?search=${encodeURIComponent(search)}`)
}

/** Nuxt UI's select: a button with a label that opens a list of options. */
async function choose(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole('combobox', { name: label }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

test('make a post in the editor and save it as a draft; quick edit and publish it; trash and restore it', async ({
  page,
}) => {
  await signIn(page, editor)
  const word = tag(page, 'post')
  const title = `${word} Blåbærsyltetøy`

  await page.goto('/admin/posts')
  await expect(page.getByRole('heading', { level: 1, name: 'Innlegg' })).toBeVisible()
  await expectNoAxeViolations(page, 'the posts list')
  await page.getByRole('link', { name: 'Legg til nytt innlegg' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Legg til nytt innlegg' })).toBeVisible()
  await page.getByLabel('Tittel').fill(title)
  await page.getByRole('button', { name: 'Lagre utkast' }).click()
  await expect(page.getByText('Lagret.')).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/posts\/[0-9a-f-]{36}$/)
  await expect(page.getByText('Status: Utkast')).toBeVisible()
  await expectNoAxeViolations(page, 'the editor of a saved draft')

  // In the list, as a draft.
  await openList(page, 'posts', word)
  await expect(page.getByText(`${title} — Utkast`)).toBeVisible()

  // Quick edit: a new title and Publisert.
  await page.getByRole('button', { name: `Hurtigredigering «${title}»` }).click()
  const dialog = page.getByRole('dialog', { name: 'Hurtigredigering' })
  await expect(dialog).toBeVisible()
  await expectNoAxeViolations(page, 'quick edit')
  const published = `${word} Publisert`
  await dialog.getByLabel('Tittel').fill(published)
  await choose(page, 'Status', 'Publisert')
  await dialog.getByRole('button', { name: 'Oppdater' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Endringene er lagret.')).toBeVisible()
  await expect(page.getByRole('button', { name: `Hurtigredigering «${published}»` })).toBeVisible()
  await expect(page.getByText(`${published} — Utkast`)).toHaveCount(0)

  // To the trash, and back.
  await page.getByRole('button', { name: `Papirkurv «${published}»` }).click()
  await expect(page.getByText('1 element flyttet til papirkurven.')).toBeVisible()
  await expect(page.getByRole('button', { name: `Papirkurv «${published}»` })).toHaveCount(0)
  await page
    .getByRole('navigation', { name: 'Innlegg etter status' })
    .getByRole('link', { name: /^Papirkurv \(\d+\)$/ })
    .click()
  await expect(page).toHaveURL(/status=trash/)
  await expectNoAxeViolations(page, 'the trash')
  await page.getByRole('button', { name: `Gjenopprett «${published}»` }).click()
  await expect(page.getByText('1 element gjenopprettet fra papirkurven.')).toBeVisible()
  await openList(page, 'posts', word)
  await expect(page.getByRole('button', { name: `Hurtigredigering «${published}»` })).toBeVisible()
  await expect(page.getByText(`${published} — Utkast`)).toHaveCount(0)
})

test('a bulk action moves the ticked posts to the trash, and the trash is emptied for good', async ({ page }) => {
  await signIn(page, editor)
  const word = tag(page, 'bulk')
  const first = `${word} En`
  const second = `${word} To`
  const kept = `${word} Tre`
  await makeItem(page, { type: 'post', title: first })
  await makeItem(page, { type: 'post', title: second })
  await makeItem(page, { type: 'post', title: kept })

  await openList(page, 'posts', word)
  await expect(page.getByText(/^3 elementer$/)).toBeVisible()
  await page.getByRole('checkbox', { name: `Velg «${first}»` }).check()
  await page.getByRole('checkbox', { name: `Velg «${second}»` }).check()
  await expect(page.getByText('2 valgt')).toBeVisible()
  await choose(page, 'Massehandlinger', 'Flytt til papirkurven')
  await page.getByRole('button', { name: 'Bruk' }).click()
  await expect(page.getByText('2 elementer flyttet til papirkurven.')).toBeVisible()
  await expect(page.getByText(/^1 element$/)).toBeVisible()
  await expect(page.getByRole('checkbox', { name: `Velg «${kept}»` })).toBeVisible()

  // In the trash: delete one of them for good, after the question.
  await page.goto(`/admin/posts?status=trash&search=${word}`)
  await page.getByRole('button', { name: `Slett permanent «${first}»` }).click()
  const confirm = page.getByRole('dialog', { name: 'Slette permanent?' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Slett permanent' }).click()
  await expect(page.getByText('1 element slettet permanent.')).toBeVisible()
  await expect(page.getByRole('button', { name: `Gjenopprett «${second}»` })).toBeVisible()
  await expect(page.getByRole('button', { name: `Gjenopprett «${first}»` })).toHaveCount(0)
})

test('a page under another page shows under it with «— », after a quick edit of its parent', async ({ page }) => {
  await signIn(page, editor)
  const word = tag(page, 'page')
  const parent = `${word} Om oss`
  const child = `${word} Historie`

  // The parent in the editor, the child too.
  for (const title of [parent, child]) {
    await page.goto('/admin/pages/new')
    await expect(page.getByRole('heading', { level: 1, name: 'Legg til ny side' })).toBeVisible()
    await page.getByLabel('Tittel').fill(title)
    await page.getByRole('button', { name: 'Lagre utkast' }).click()
    await expect(page).toHaveURL(/\/admin\/pages\/[0-9a-f-]{36}$/)
  }

  // «Mine»: only this file's pages, still as a tree (a search would show a flat list).
  await page.goto('/admin/pages?author=mine')
  await expect(page.getByRole('heading', { level: 1, name: 'Sider' })).toBeVisible()
  await page.getByRole('button', { name: `Hurtigredigering «${child}»` }).click()
  const dialog = page.getByRole('dialog', { name: 'Hurtigredigering' })
  await choose(page, 'Forelder', parent)
  await dialog.getByRole('button', { name: 'Oppdater' }).click()
  await expect(dialog).toBeHidden()

  // The tree: the child right after its parent, with a dash.
  await expect(page.getByText(`— ${child}`)).toBeVisible()
  const titles = await page
    .getByRole((page.viewportSize()?.width ?? 1280) < 768 ? 'listitem' : 'row')
    .filter({ hasText: word })
    .allInnerTexts()
  const parentIndex = titles.findIndex((text) => text.includes(parent) && !text.includes(`— ${child}`))
  const childIndex = titles.findIndex((text) => text.includes(`— ${child}`))
  expect(childIndex).toBe(parentIndex + 1)
  await expectNoAxeViolations(page, 'the pages list with a child page')
})

test('screen options hide the author column and are kept with the account', async ({ page }) => {
  const user = await createUser('editor', 'screenopts')
  await signIn(page, user)
  await page.goto('/admin/posts')
  await page.getByRole('button', { name: 'Skjermalternativer' }).click()
  const dialog = page.getByRole('dialog', { name: 'Skjermalternativer' })
  await expectNoAxeViolations(page, 'screen options')
  await dialog.getByRole('checkbox', { name: 'Forfatter' }).uncheck()
  await dialog.getByLabel('Antall elementer per side').fill('5')
  await dialog.getByRole('button', { name: 'Bruk' }).click()
  await expect(dialog).toBeHidden()
  await page.reload()
  const isTable = (page.viewportSize()?.width ?? 1280) >= 768
  if (isTable) {
    await expect(page.getByRole('columnheader', { name: 'Forfatter' })).toHaveCount(0)
    await expect(page.getByRole('columnheader', { name: /Dato/ })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Skjermalternativer' }).click()
  await expect(
    page.getByRole('dialog', { name: 'Skjermalternativer' }).getByLabel('Antall elementer per side'),
  ).toHaveValue('5')
})
