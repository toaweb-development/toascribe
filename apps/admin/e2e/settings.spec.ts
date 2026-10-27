import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { signIn } from './helpers/screens.ts'
import { createUser, linkIn, setSetting, uniqueName, waitForMail } from './helpers/stack.ts'
import type { TestUser } from './helpers/stack.ts'

// The settings screens of M1.5: «Generelt» with the administrator address that changes only after its confirmation (K-192),
// «Lesing» with a static front page that the site shows (K-226), and «Personvern» with the page the site's footer links (K-199).
// Each test runs at 375 px and 1280 px, with axe and the CSP check of the fixture.

let admin: TestUser

test.beforeAll(async () => {
  admin = await createUser('administrator', 'settingsadmin')
})

test('Generelt: the title, and a new administrator address that waits for its confirmation', async ({ page }) => {
  await signIn(page, admin)
  await page.goto('/admin/settings/general')
  await expect(page.getByRole('heading', { name: 'Generelle innstillinger' })).toBeVisible()
  await expectNoAxeViolations(page, 'Settings → General')
  const address = `${uniqueName('nyadmin')}@example.test`
  await page.getByLabel('Ny administrator-e-postadresse').fill(address)
  await page.getByRole('button', { name: 'Lagre endringer' }).click()
  await expect(page.getByText(`Venter på bekreftelse av ${address}.`)).toBeVisible()

  const link = linkIn(await waitForMail(address, /administrator-e-postadressen/), 'confirmadminemail')
  await page.goto(link.replace(/^https?:\/\/[^/]+/, ''))
  await expect(page.getByText(`Administrator-e-postadressen for nettstedet er nå ${address}.`)).toBeVisible()
  await page.goto('/admin/settings/general')
  await expect(page.getByText(`Adressen nå er ${address}.`)).toBeVisible()
})

test('Lesing: a static front page, shown on the site', async ({ page }) => {
  await signIn(page, admin)
  const title = `Velkommen ${uniqueName('front')}`
  await page.goto('/admin/pages/new')
  await page.getByRole('textbox', { name: 'Tittel', exact: true }).fill(title)
  await page.getByRole('button', { name: 'Publiser', exact: true }).click()
  await expect(page.getByText('Publisert.').first()).toBeVisible()

  try {
    await page.goto('/admin/settings/reading')
    await expect(page.getByRole('heading', { name: 'Leseinnstillinger' })).toBeVisible()
    await page.getByRole('radio', { name: 'En statisk side' }).check()
    await page.getByRole('combobox', { name: 'Forside' }).click()
    await page.getByRole('option', { name: title }).click()
    await expectNoAxeViolations(page, 'Settings → Reading')
    await page.getByRole('button', { name: 'Lagre endringer' }).click()
    await expect(page.getByText('Innstillingene er lagret.')).toBeVisible()

    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  } finally {
    await setSetting('show_on_front', 'posts')
    await setSetting('page_on_front', null)
  }
})

test('Personvern: the chosen page is linked in the footer once it is published', async ({ page }) => {
  await signIn(page, admin)
  await page.goto('/admin/settings/privacy')
  await expect(page.getByRole('heading', { name: 'Personvern' })).toBeVisible()
  await expectNoAxeViolations(page, 'Settings → Privacy')
  await page.getByRole('button', { name: 'Opprett ny personvernside' }).click()
  await expect(page).toHaveURL(/\/admin\/pages\/[0-9a-f-]{36}$/)
  await page.getByRole('button', { name: 'Publiser', exact: true }).click()
  await expect(page.getByText('Publisert.').first()).toBeVisible()
  await page.goto('/')
  const footer = page.getByRole('contentinfo')
  await expect(footer.getByRole('link', { name: 'Personvernerklæring' })).toBeVisible()
})
