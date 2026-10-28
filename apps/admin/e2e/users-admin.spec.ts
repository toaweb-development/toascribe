import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { signIn } from './helpers/screens.ts'
import { compose, createUser, queryRows, uniqueName } from './helpers/stack.ts'
import type { TestUser } from './helpers/stack.ts'

// M1.8: «Legg til ny bruker» (K-020), «Applikasjonspassord» on the profile (K-016) and «Slett bruker» with the content moved to
// another account (K-021). Each test runs at 375 px and 1280 px, with axe and the CSP check of the fixture.

let admin: TestUser

test.beforeAll(async () => {
  admin = await createUser('administrator', 'brukeradmin')
})

test('Legg til ny bruker: with a password set here, active with the role chosen', async ({ page }) => {
  const username = uniqueName('nybruker')
  await signIn(page, admin)
  await page.goto('/admin/users/new')
  await expect(page.getByRole('heading', { name: 'Legg til ny bruker' }).first()).toBeVisible()
  await page.getByLabel('Brukernavn', { exact: true }).fill(username)
  await page.getByLabel('E-post', { exact: true }).fill(`${username}@example.test`)
  await page.getByLabel('Fornavn', { exact: true }).fill('Kari')
  await page.getByRole('checkbox', { name: 'Send invitasjon på e-post' }).click()
  await page.getByRole('button', { name: 'Generer passord' }).click()
  await expectNoAxeViolations(page, 'Users → Add new')
  await page.getByRole('button', { name: 'Legg til ny bruker' }).last().click()
  await expect(page.getByText(`Brukeren ${username} er opprettet.`)).toBeVisible()
  expect(
    await queryRows(
      `select a.status || ' ' || r.slug from account a join account_role ar on ar.account_id = a.id join role r on r.id = ar.role_id where a.username = '${username}'`,
    ),
  ).toEqual(['active subscriber'])
})

test('Applikasjonspassord: made, shown once, refused over plain HTTP, revoked', async ({ page }) => {
  await signIn(page, admin)
  await page.goto('/admin/profile')
  const name = uniqueName('skript')
  await page.getByLabel('Navn på nytt applikasjonspassord').fill(name)
  await page.getByRole('button', { name: 'Legg til nytt applikasjonspassord' }).click()
  const made = page.getByTestId('app-password-made')
  await expect(made).toBeVisible()
  const password = (await made.locator('p.font-mono').innerText()).trim()
  expect(password).toMatch(/^([A-Za-z0-9]{4} ){5}[A-Za-z0-9]{4}$/)
  await expectNoAxeViolations(page, 'Profile → Application passwords')

  // The stack answers over plain HTTP, so Basic is refused before the password is looked at.
  const api = await page.request.get('/api/v1/content?type=post', {
    headers: { authorization: `Basic ${Buffer.from(`${admin.username}:${password}`).toString('base64')}` },
  })
  expect(api.status()).toBe(403)
  expect(await api.text()).toContain('https_required')

  await page.reload()
  await expect(page.getByText(name, { exact: true })).toBeVisible()
  await expect(page.getByText(password)).toHaveCount(0)
  await page.getByRole('button', { name: `Tilbakekall ${name}` }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Tilbakekall', exact: true }).click()
  await expect(page.getByText(`${name} er tilbakekalt.`)).toBeVisible()
})

test('Slett bruker: the content goes to another account', async ({ page }) => {
  const author = await createUser('author', 'avtroppende')
  const title = `Arv ${uniqueName('innlegg')}`
  await compose(['exec', '-T', 'api', 'toa', 'post', 'create', '--title', title, '--user', author.username])
  const [id] = await queryRows(`select id from account where username = '${author.username}'`)
  await signIn(page, admin)
  await page.goto(`/admin/users/${id ?? ''}/delete`)
  await expect(page.getByText(`${author.username} (${author.email})`)).toBeVisible()
  await page.getByRole('radio', { name: 'Tilordne alt innhold til:' }).check()
  await expectNoAxeViolations(page, 'Users → Delete')
  await page.getByRole('combobox', { name: 'Ny eier' }).click()
  await page.getByRole('option', { name: new RegExp(`^${admin.username} `) }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await page.getByRole('button', { name: 'Bekreft sletting' }).click()
  await expect(page.getByText(`Brukeren ${author.username} er slettet.`)).toBeVisible()
  const owners = await queryRows(
    `select a.username from content c join content_author ca on ca.content_id = c.id join account a on a.id = ca.account_id where c.title = '${title}'`,
  )
  expect(owners).toEqual([admin.username])
})
