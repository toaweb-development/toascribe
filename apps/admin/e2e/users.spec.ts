import type { Page } from '@playwright/test'

import { createUser, queryRows, resetLimits, runSql } from './helpers/stack.ts'
import type { TestUser } from './helpers/stack.ts'
import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { signIn } from './helpers/screens.ts'

// The users list (M0.5; WordPress' users.php): the views with their counts, the search, the sort, the pages, the address as the state
// of the list, and the bulk change of role with its messages. Each test runs at 375 px (a list of accounts) and at 1280 px (a table).
//
// The accounts of other specs, and of the other width, share the database, so a count is compared with itself before and after, and a
// list is narrowed to this file's own accounts with the search (every username starts with `prefix`). Every new account is announced to
// the administrators by mail, so one administrator is made for the file; the demotion test makes one more.

let prefix: string
let admin: TestUser
let author1: TestUser
let author2: TestUser
let subscriber: TestUser

test.beforeAll(async () => {
  prefix = `ul${Date.now().toString(36).slice(-6)}`
  // The letter after the prefix fixes the order of the e-mail addresses: a, c, d, e.
  admin = await createUser('administrator', `${prefix}a`)
  author1 = await createUser('author', `${prefix}c`)
  author2 = await createUser('author', `${prefix}d`)
  subscriber = await createUser('subscriber', `${prefix}e`)
})

test.beforeEach(async () => {
  await resetLimits()
})

const isCompact = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 768

const viewsNav = (page: Page) => page.getByRole('navigation', { name: 'Brukere etter rolle' })
const searchBox = (page: Page) => page.getByRole('searchbox', { name: 'Søk i brukere' })
const count = (page: Page) => page.getByText(/^\d+ element(er)?$/)

/** The accounts as rows: the body rows of the table from md, the entries of the list below it. */
function dataRows(page: Page) {
  return isCompact(page)
    ? page.getByRole('list', { name: 'Brukerliste' }).getByRole('listitem')
    : page.getByRole('table', { name: 'Brukerliste' }).locator('tbody').getByRole('row')
}

const rowOf = (page: Page, username: string) => dataRows(page).filter({ hasText: username })

/** The number in a view's link («Redaktør (3)»), or 0 when the view is not there because nobody holds the role. */
async function viewCount(page: Page, label: string): Promise<number> {
  const link = viewsNav(page).getByRole('link', { name: new RegExp(`^${label} \\(\\d+\\)$`) })
  if ((await link.count()) === 0) {
    return 0
  }
  const found = /\((\d+)\)/.exec(await link.innerText())
  return Number(found?.[1] ?? Number.NaN)
}

const emailsInOrder = (page: Page) => page.locator('a[href^="mailto:"]:visible').allTextContents()

async function openUsers(page: Page, user: Pick<TestUser, 'username' | 'password'>, query = ''): Promise<void> {
  await signIn(page, user)
  await page.goto(`/admin/users${query}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Brukere' })).toBeVisible()
}

async function searchFor(page: Page, text: string): Promise<void> {
  await searchBox(page).fill(text)
  await searchBox(page).press('Enter')
  await expect(page).toHaveURL(new RegExp(`search=${encodeURIComponent(text)}`))
}

async function tick(page: Page, user: Pick<TestUser, 'username'>): Promise<void> {
  await page.getByRole('checkbox', { name: `Velg ${user.username}` }).check()
}

/** Nuxt UI's select: a button with the label «Endre rolle til» that opens a list of options. */
async function chooseRole(page: Page, roleName: string): Promise<void> {
  await page.getByRole('combobox', { name: 'Endre rolle til' }).click()
  await page.getByRole('option', { name: roleName, exact: true }).click()
}

async function change(page: Page, roleName: string): Promise<void> {
  await chooseRole(page, roleName)
  await page.getByRole('button', { name: 'Endre', exact: true }).click()
}

const query = (page: Page, name: string) => new URL(page.url()).searchParams.get(name)

test('shows the views with their counts and filters by them', async ({ page }) => {
  await openUsers(page, admin)

  // «Alle» is the current view, marked for assistive technology; the table is a table from md and a list below it.
  await expect(viewsNav(page).getByRole('link', { name: /^Alle \(\d+\)$/ })).toHaveAttribute('aria-current', 'page')
  if (isCompact(page)) {
    await expect(page.getByRole('table')).toHaveCount(0)
    await expect(page.getByRole('list', { name: 'Brukerliste' })).toBeVisible()
  } else {
    await expect(page.getByRole('table', { name: 'Brukerliste' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'E-post' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Innlegg' })).toBeVisible()
  }

  const subscribers = await viewCount(page, 'Abonnent')
  expect(subscribers).toBeGreaterThan(0)
  await viewsNav(page)
    .getByRole('link', { name: /^Abonnent \(\d+\)$/ })
    .click()
  await expect(page).toHaveURL(/role=subscriber/)
  await expect(viewsNav(page).getByRole('link', { name: /^Abonnent \(/ })).toHaveAttribute('aria-current', 'page')
  await expect(viewsNav(page).getByRole('link', { name: /^Alle \(/ })).not.toHaveAttribute('aria-current', 'page')
  // The result count is the view's count, and the file's own subscriber is in it with the role named in Norwegian.
  await expect(count(page)).toHaveText(new RegExp(`^${subscribers} element(er)?$`))
  await searchFor(page, subscriber.username)
  await expect(dataRows(page)).toHaveCount(1)
  await expect(rowOf(page, subscriber.username)).toContainText('Abonnent')
  await expect(rowOf(page, subscriber.username)).toContainText(subscriber.email)
  await expect(page.getByRole('link', { name: subscriber.email })).toHaveAttribute('href', `mailto:${subscriber.email}`)

  // The administrator's own row is marked.
  await viewsNav(page)
    .getByRole('link', { name: /^Alle \(/ })
    .click()
  await expect(page).not.toHaveURL(/role=/)
  await searchFor(page, admin.username)
  await expect(rowOf(page, admin.username)).toContainText('Deg')
  await expect(rowOf(page, admin.username)).toContainText('Administrator')
  await expect(rowOf(page, admin.username)).toContainText('0')
})

test('searches when the form is sent, shows what is searched for and gets back', async ({ page }) => {
  await openUsers(page, admin)

  await searchBox(page).fill(`${prefix}c`)
  // Not on every key: nothing has been asked for yet.
  await expect(page).not.toHaveURL(/search=/)
  await page.getByRole('button', { name: 'Søk i brukere' }).click()
  await expect(page).toHaveURL(new RegExp(`search=${prefix}c`))
  await expect(dataRows(page)).toHaveCount(1)
  await expect(rowOf(page, author1.username)).toBeVisible()
  await expect(page.getByText(`Søkeresultater for: ${prefix}c`)).toBeVisible()
  await expect(count(page)).toHaveText('1 element')

  // Part of a name, e-mail address and a word that is nowhere.
  await searchFor(page, `${prefix}`)
  await expect(dataRows(page)).toHaveCount(4)
  await searchFor(page, 'ingen-har-dette-navnet-xyz')
  await expect(page.getByText('Ingen brukere funnet.')).toBeVisible()
  await expect(page.getByRole('table')).toHaveCount(0)
  await expect(count(page)).toHaveText('0 elementer')
  await expectNoAxeViolations(page, 'the users list without results')

  // «Vis alle» removes the search and any view.
  await page.getByRole('link', { name: 'Vis alle' }).click()
  await expect(page).not.toHaveURL(/search=/)
  await expect(searchBox(page)).toHaveValue('')
  await expect(dataRows(page).first()).toBeVisible()

  // «Tøm søket» does the same for a search that has results.
  await searchFor(page, prefix)
  await page.getByRole('link', { name: 'Tøm søket' }).click()
  await expect(page).not.toHaveURL(/search=/)
  await expect(searchBox(page)).toHaveValue('')
})

test('sorts by e-mail address both ways and marks the column', async ({ page }) => {
  await openUsers(page, admin, `?search=${prefix}`)
  const ours = [admin.email, author1.email, author2.email, subscriber.email]
  const mine = async () => (await emailsInOrder(page)).filter((email) => email.includes(prefix))

  // Sorted by username, ascending, as WordPress starts.
  expect(await mine()).toEqual(ours)
  if (isCompact(page)) {
    await expect(
      page.getByRole('navigation', { name: 'Sorter brukerne' }).getByRole('link', { name: /^Brukernavn/ }),
    ).toHaveAttribute('aria-current', 'true')
  } else {
    await expect(page.getByRole('columnheader', { name: 'Brukernavn' })).toHaveAttribute('aria-sort', 'ascending')
    await expect(page.getByRole('columnheader', { name: 'E-post' })).toHaveAttribute('aria-sort', 'none')
  }

  const sortLink = isCompact(page)
    ? page.getByRole('navigation', { name: 'Sorter brukerne' }).getByRole('link', { name: /^E-post/ })
    : page.getByRole('columnheader', { name: 'E-post' }).getByRole('link')
  await sortLink.click()
  await expect(page).toHaveURL(/orderby=email/)
  expect(query(page, 'order')).toBeNull() // ascending is the default and stays out of the address
  expect(await mine()).toEqual(ours)
  if (!isCompact(page)) {
    await expect(page.getByRole('columnheader', { name: 'E-post' })).toHaveAttribute('aria-sort', 'ascending')
  }

  await sortLink.click()
  await expect(page).toHaveURL(/order=desc/)
  await expect.poll(mine).toEqual([...ours].reverse())
  if (!isCompact(page)) {
    await expect(page.getByRole('columnheader', { name: 'E-post' })).toHaveAttribute('aria-sort', 'descending')
  }
  // The sort is kept when another view is chosen, and the search with it.
  await viewsNav(page)
    .getByRole('link', { name: /^Abonnent \(/ })
    .click()
  await expect(page).toHaveURL(/orderby=email/)
  await expect(page).toHaveURL(/order=desc/)
  await expect(page).toHaveURL(new RegExp(`search=${prefix}`))
})

test('keeps the state of the list in the address, through a reload and the back button', async ({ page }) => {
  await openUsers(
    page,
    admin,
    `?role=subscriber&search=${encodeURIComponent(subscriber.username)}&orderby=email&order=desc`,
  )
  const check = async () => {
    await expect(viewsNav(page).getByRole('link', { name: /^Abonnent \(/ })).toHaveAttribute('aria-current', 'page')
    await expect(searchBox(page)).toHaveValue(subscriber.username)
    await expect(dataRows(page)).toHaveCount(1)
    if (!isCompact(page)) {
      await expect(page.getByRole('columnheader', { name: 'E-post' })).toHaveAttribute('aria-sort', 'descending')
    }
  }
  await check()
  await page.reload()
  await check()

  // A step in the list is a step in the history.
  await viewsNav(page)
    .getByRole('link', { name: /^Alle \(/ })
    .click()
  await expect(page).not.toHaveURL(/role=/)
  await page.goBack()
  await expect(page).toHaveURL(/role=subscriber/)
  await check()

  // An address with nonsense in it is the plain list, not an error.
  await page.goto('/admin/users?role=%3Cb%3E&orderby=password&order=up&page=-4')
  await expect(page.getByRole('heading', { level: 1, name: 'Brukere' })).toBeVisible()
  await expect(viewsNav(page).getByRole('link', { name: /^Alle \(/ })).toHaveAttribute('aria-current', 'page')
  await expect(dataRows(page).first()).toBeVisible()
})

test('pages the list, 20 to a page, with the page in the address', async ({ page }) => {
  const pagePrefix = `pg${prefix.slice(2)}`
  await runSql(
    `with made as (
       insert into account (username, email, display_name, nicename, status)
       select '${pagePrefix}' || lpad(i::text, 2, '0'), '${pagePrefix}' || lpad(i::text, 2, '0') || '@example.test', 'Paged ' || i, '${pagePrefix}' || lpad(i::text, 2, '0'), 'active'
       from generate_series(1, 25) as i
       returning id)
     insert into account_role (account_id, role_id) select made.id, (select id from role where slug = 'subscriber') from made`,
  )
  await openUsers(page, admin, `?search=${pagePrefix}`)

  await expect(count(page)).toHaveText('25 elementer')
  await expect(dataRows(page)).toHaveCount(20)
  const pages = page.getByRole('navigation', { name: 'Sideinndeling' })
  await expect(pages.getByRole('link', { name: 'Side 1' })).toHaveAttribute('aria-current', 'page')
  await expect(pages.getByRole('link', { name: 'Forrige' })).toHaveCount(0)
  await expect(pages.getByRole('link', { name: 'Side 3' })).toHaveCount(0)

  await pages.getByRole('link', { name: 'Neste' }).click()
  await expect(page).toHaveURL(/page=2/)
  await expect(dataRows(page)).toHaveCount(5)
  await expect(rowOf(page, `${pagePrefix}25`)).toBeVisible()
  await expect(pages.getByRole('link', { name: 'Side 2' })).toHaveAttribute('aria-current', 'page')
  await expect(pages.getByRole('link', { name: 'Neste' })).toHaveCount(0)
  // The last page has no «Neste», so focus is not left on a link that is gone.
  await expect(page.getByRole('heading', { name: 'Brukerliste' })).toBeFocused()

  await page.reload()
  await expect(dataRows(page)).toHaveCount(5)
  await expect(pages.getByRole('link', { name: 'Side 2' })).toHaveAttribute('aria-current', 'page')

  // A search starts on the first page again, and a page past the end goes to the last one that exists.
  await page.goto(`/admin/users?search=${pagePrefix}&page=9`)
  await expect(page).toHaveURL(/page=2/)
  await expect(dataRows(page)).toHaveCount(5)
  await pages.getByRole('link', { name: 'Forrige' }).click()
  await expect(dataRows(page)).toHaveCount(20)
  await expectNoAxeViolations(page, 'the users list with pages')
})

test('offers only the roles the account may give', async ({ page }) => {
  const manager = await createUser('subscriber', `${prefix}m`)
  const slug = `e2e-people-${prefix}`
  try {
    await runSql(
      `insert into role (slug, name, capabilities) select '${slug}', 'Folkesjef', capabilities || array['list_users', 'promote_users'] from role where slug = 'author'`,
    )
    await runSql(
      `update account_role set role_id = (select id from role where slug = '${slug}') where account_id = (select id from account where username = '${manager.username}')`,
    )
    await openUsers(page, manager, `?search=${prefix}`)
    const select = page.getByRole('combobox', { name: 'Endre rolle til' })
    await expect(select).toHaveText('Velg rolle…')
    await select.click()
    // An author's rights and the rights over users: authors, contributors, subscribers and this role itself can be given; editors and administrators cannot.
    await expect(page.getByRole('option')).toHaveText(['Forfatter', 'Bidragsyter', 'Abonnent', 'Folkesjef'])
    await page.keyboard.press('Escape')
  } finally {
    await runSql(`delete from account where username = '${manager.username}'`)
    await runSql(`delete from role where slug = '${slug}'`)
  }
})

test('changes the role of several accounts, and the counts follow', async ({ page }) => {
  await openUsers(page, admin, `?search=${prefix}`)
  const editors = await viewCount(page, 'Redaktør')
  const authors = await viewCount(page, 'Forfatter')

  // «Endre» does nothing until someone is ticked and a role is chosen, and says so.
  const submit = page.getByRole('button', { name: 'Endre', exact: true })
  await expect(submit).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByText('Kryss av for brukerne du vil endre rolle for.')).toBeVisible()
  await tick(page, author1)
  await expect(page.getByText('1 valgt')).toBeVisible()
  await expect(page.getByText('Velg hvilken rolle de skal få.')).toBeVisible()
  await tick(page, author2)
  await chooseRole(page, 'Redaktør')
  await expect(submit).not.toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByText('2 valgt')).toBeVisible()
  await expectNoAxeViolations(page, 'the users list with two accounts ticked')

  await submit.click()
  await expect(page.getByText('Endret rolle for 2 brukere.')).toBeVisible()
  // Nothing was left alone, so there is no list of reasons; the rows show the new role and nobody is ticked any more.
  await expect(page.getByText('ble ikke endret')).toHaveCount(0)
  await expect(rowOf(page, author1.username)).toContainText('Redaktør')
  await expect(rowOf(page, author2.username)).toContainText('Redaktør')
  await expect(page.getByRole('checkbox', { name: `Velg ${author1.username}` })).not.toBeChecked()
  await expect(page.getByText(/\d+ valgt/)).toHaveCount(0)
  await expect.poll(() => viewCount(page, 'Redaktør')).toBe(editors + 2)
  await expect.poll(() => viewCount(page, 'Forfatter')).toBe(authors - 2)
  await expectNoAxeViolations(page, 'the users list after a change of role')

  // The same role again is reported briefly and not as a change.
  await tick(page, author1)
  await change(page, 'Redaktør')
  await expect(page.getByText('Ingen roller ble endret.')).toBeVisible()
  await expect(page.getByText(`${author1.username} hadde allerede rollen Redaktør.`)).toBeVisible()

  // Back for the next width: the same two accounts are authors again.
  await tick(page, author1)
  await tick(page, author2)
  await change(page, 'Forfatter')
  await expect(page.getByText('Endret rolle for 2 brukere.')).toBeVisible()
})

test('leaves the own account alone and says so, and changes the others', async ({ page }) => {
  await openUsers(page, admin, `?search=${prefix}`)
  await tick(page, admin)
  await tick(page, subscriber)
  await change(page, 'Forfatter')

  // Partial success is a warning that names who was changed and who was not, never a plain «done».
  const result = page.getByRole('status').filter({ hasText: 'Endret rolle for én bruker.' })
  await expect(result).toBeVisible()
  await expect(result).toContainText('1 bruker ble ikke endret.')
  await expect(result).toContainText('Du kan ikke endre din egen rolle.')
  await expect(rowOf(page, subscriber.username)).toContainText('Forfatter')
  await expect(rowOf(page, admin.username)).toContainText('Administrator')
  // The skipped account stays ticked, next to the message about it; the changed one does not.
  await expect(page.getByRole('checkbox', { name: `Velg ${admin.username}` })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: `Velg ${subscriber.username}` })).not.toBeChecked()
  await expectNoAxeViolations(page, 'the users list after a change that left an account alone')

  // Back for the next width.
  await tick(page, subscriber)
  await page.getByRole('checkbox', { name: `Velg ${admin.username}` }).uncheck()
  await change(page, 'Abonnent')
  await expect(page.getByText('Endret rolle for én bruker.')).toBeVisible()
})

test('asks before taking the administrator role, changes the other administrator and refuses the last one', async ({
  browser,
  page,
}) => {
  const other = await createUser('administrator', `${prefix}b`)
  const superSlug = `e2e-super-${prefix}`
  const superUser = await createUser('subscriber', `${prefix}x`)
  // Only these administrators count: the others of the shared database are set aside for the test and put back after it.
  const aside = await queryRows(
    `select a.id from account a join account_role ar on ar.account_id = a.id join role r on r.id = ar.role_id
     where r.slug = 'administrator' and a.status = 'active' and a.username not in ('${admin.username}', '${other.username}')`,
  )
  const asideList = aside.map((id) => `'${id}'`).join(', ')
  try {
    // An account with every right of an administrator that is not the administrator role: it can demote an administrator and is not
    // counted as one.
    await runSql(
      `insert into role (slug, name, capabilities) select '${superSlug}', 'E2E super', capabilities from role where slug = 'administrator'`,
    )
    await runSql(
      `update account_role set role_id = (select id from role where slug = '${superSlug}') where account_id = (select id from account where username = '${superUser.username}')`,
    )
    if (aside.length > 0) {
      await runSql(`update account set status = 'disabled' where id in (${asideList})`)
    }

    // 1. Two administrators: the signed-in one takes the role from the other. The dialog says how many, cancel changes nothing.
    await openUsers(page, admin, `?search=${other.username}`)
    await tick(page, other)
    await change(page, 'Redaktør')
    const dialog = page.getByRole('dialog', { name: 'Endre rolle for én administrator?' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(
      'Administratoren mister tilgangen til alt som bare administratorer kan gjøre, og får rollen Redaktør.',
    )
    await expect(dialog.getByRole('button', { name: 'Avbryt' })).toBeFocused()
    await dialog.getByRole('button', { name: 'Avbryt' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(rowOf(page, other.username)).toContainText('Administrator')

    await page.getByRole('button', { name: 'Endre', exact: true }).click()
    await dialog.getByRole('button', { name: 'Endre rolle' }).click()
    await expect(page.getByText('Endret rolle for én bruker.')).toBeVisible()
    await expect(rowOf(page, other.username)).toContainText('Redaktør')

    // 2. One administrator is left, and somebody else asks to take the role from it: refused, with the reason.
    const second = await browser.newContext({ viewport: page.viewportSize() })
    try {
      const page2 = await second.newPage()
      await openUsers(page2, superUser, `?search=${admin.username}`)
      await expect(rowOf(page2, admin.username)).toContainText('Administrator')
      await tick(page2, admin)
      await change(page2, 'Redaktør')
      const dialog2 = page2.getByRole('dialog', { name: 'Endre rolle for én administrator?' })
      await dialog2.getByRole('button', { name: 'Endre rolle' }).click()
      const result = page2.getByRole('status').filter({ hasText: 'Ingen roller ble endret.' })
      await expect(result).toBeVisible()
      await expect(result).toContainText(
        `Nettstedet må ha minst én administrator, så ${admin.username} beholder rollen.`,
      )
      await expect(rowOf(page2, admin.username)).toContainText('Administrator')
      await expectNoAxeViolations(page2, 'the refusal to take the role from the last administrator')
    } finally {
      await second.close()
    }
  } finally {
    if (aside.length > 0) {
      await runSql(`update account set status = 'active' where id in (${asideList})`)
    }
    await runSql(`delete from account where username = '${superUser.username}'`)
    await runSql(`delete from role where slug = '${superSlug}'`)
  }
})

test('does not show the users to an account that may not list them', async ({ page, allowFailedRequests }) => {
  // The page answers 403, which the browser logs as a failed request.
  allowFailedRequests()
  const reader = await createUser('subscriber', `${prefix}s`)
  await signIn(page, reader)
  const answer = await page.goto('/admin/users')
  expect(answer?.status()).toBe(403)
  await expect(page.getByRole('heading', { level: 1, name: 'Brukere' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Du har ikke tilgang til brukerne' })).toBeVisible()
  await expect(page.getByText('Spør en administrator hvis du trenger tilgang.')).toBeVisible()
  await expect(page.getByRole('table')).toHaveCount(0)
  await expect(page.getByRole('searchbox')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Endre', exact: true })).toHaveCount(0)
  await expectNoAxeViolations(page, 'the users page without access')
  await page.getByRole('link', { name: 'Til kontrollpanelet' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Kontrollpanel' })).toBeVisible()
})

test('sends an anonymous visitor to the login screen and back', async ({ page }) => {
  await page.goto(`/admin/users?search=${prefix}&role=subscriber`)
  await expect(page).toHaveURL(/\/admin\/login/)
  await expect(page.getByRole('heading', { level: 1, name: 'Logg inn' })).toBeVisible()
})

test('has no accessibility violations on the list', async ({ page }) => {
  await openUsers(page, admin, `?search=${prefix}`)
  await expect(dataRows(page).first()).toBeVisible()
  await expectNoAxeViolations(page, 'the users list')
  await page.getByRole('searchbox', { name: 'Søk i brukere' }).focus()
  await expectNoAxeViolations(page, 'the users list with the search focused')
})
