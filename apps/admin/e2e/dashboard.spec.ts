import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { signIn } from './helpers/screens.ts'
import { createUser, queryRows, uniqueName } from './helpers/stack.ts'
import type { TestUser } from './helpers/stack.ts'

// M1.8: the dashboard's «Aktivitet», «Hurtigutkast» and «Nettstedshelse» (K-033), and «Hjelp» in the bar (K-038). At 375 px and
// 1280 px, with axe and the CSP check of the fixture.

let admin: TestUser
let contributor: TestUser

test.beforeAll(async () => {
  admin = await createUser('administrator', 'panel')
  contributor = await createUser('contributor', 'panelbidrag')
})

test('Hurtigutkast saves a draft that shows among the own drafts; Aktivitet and Nettstedshelse are there', async ({
  page,
}) => {
  await signIn(page, admin)
  const title = `Rask tanke ${uniqueName('kladd')}`
  const draft = page.getByRole('region', { name: 'Hurtigutkast' })
  await draft.getByRole('button', { name: 'Lagre kladd' }).click()
  await expect(draft.getByText('Skriv en tittel eller litt innhold først.')).toBeVisible()
  await draft.getByLabel('Tittel').fill(title)
  await draft.getByLabel('Innhold').fill('Første avsnitt.\n\nAndre avsnitt.')
  await draft.getByRole('button', { name: 'Lagre kladd' }).click()
  await expect(draft.getByText('Kladden er lagret.')).toBeVisible()
  await expect(
    draft.getByRole('region', { name: 'Dine siste kladder' }).getByRole('link', { name: title }),
  ).toBeVisible()
  await expect(draft.getByLabel('Tittel')).toHaveValue('')
  expect(
    await queryRows(
      `select status || ' ' || jsonb_array_length(blocks)::text from content where title = '${title}' and type = 'post'`,
    ),
  ).toEqual(['draft 2'])

  await expect(page.getByRole('region', { name: 'Aktivitet' })).toBeVisible()
  const health = page.getByRole('region', { name: 'Nettstedshelse' })
  // The e2e stack is installed with --skip-email: at least that check is not good.
  await expect(health.getByText('E-postinnstillingene er ikke bekreftet med en testmelding.')).toBeVisible()
  await expect(health.getByRole('link', { name: 'Se Nettstedshelse' })).toHaveAttribute(
    'href',
    '/admin/tools/site-health',
  )
  await expectNoAxeViolations(page, 'the dashboard with its widgets')
})

test('a contributor sees Aktivitet and Hurtigutkast, not Nettstedshelse', async ({ page }) => {
  await signIn(page, contributor)
  await expect(page.getByRole('region', { name: 'Hurtigutkast' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Aktivitet' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Nettstedshelse' })).toHaveCount(0)
})

test('Hjelp links the screen to its page of the user documentation', async ({ page }) => {
  await signIn(page, admin)
  const help = page.getByRole('link', { name: /^Hjelp/ })
  await expect(help).toHaveAttribute('href', /\/blob\/v\d+\.\d+\.\d+[^/]*\/docs\/user\/README\.md$/)
  await expect(help).toHaveAttribute('target', '_blank')
  await page.goto('/admin/appearance/menus')
  await expect(page.getByRole('link', { name: /^Hjelp/ })).toHaveAttribute('href', /\/docs\/user\/menyer\.md$/)
})
