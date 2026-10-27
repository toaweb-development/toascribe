import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { signIn } from './helpers/screens.ts'
import { createUser, setSetting } from './helpers/stack.ts'
import type { TestUser } from './helpers/stack.ts'

// «Oppdateringer» (M1.7, K-290) and «Verktøy → Nettstedshelse → Info» (M1.7, K-203), at 375 px and 1280 px with axe and the CSP
// check of the fixture. The update status is set by hand: the stack never asks ghcr.io in a test (the worker's first check may run,
// and is replaced here). «Kopier til utklippstavlen» puts the redacted text on the clipboard: no e-mail address, address or path.

let admin: TestUser

test.beforeAll(async () => {
  admin = await createUser('administrator', 'verktoyadmin')
})

test('Oppdateringer: a newer release with its changelog and the host command; the check turned off and on', async ({
  page,
}) => {
  await setSetting('update_status', {
    checkedAt: '2026-10-28T04:41:00.000Z',
    current: '0.0.0',
    latest: '99.0.0',
    ok: true,
    error: null,
  })
  await signIn(page, admin)
  await page.goto('/admin/updates')
  await expect(page.getByRole('heading', { name: /Du kjører toascribe/ })).toBeVisible()
  await expect(page.getByText('toascribe 99.0.0 er tilgjengelig.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Se hva som er nytt i 99.0.0' })).toHaveAttribute(
    'href',
    'https://github.com/toaweb-development/toascribe/blob/v99.0.0/CHANGELOG.md',
  )
  await expect(page.getByTestId('update-command')).toHaveText('docker compose pull\ndocker compose up -d')
  await expectNoAxeViolations(page, 'Updates')

  const toggle = page.getByRole('switch', { name: 'Se etter nye versjoner én gang i døgnet' })
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await page.reload()
  await expect(page.getByRole('switch', { name: 'Se etter nye versjoner én gang i døgnet' })).not.toBeChecked()
  await page.getByRole('switch', { name: 'Se etter nye versjoner én gang i døgnet' }).click()
  await expect(page.getByRole('switch', { name: 'Se etter nye versjoner én gang i døgnet' })).toBeChecked()
})

test('Nettstedshelse → Info: every group, and «Kopier» with nothing secret on the clipboard', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await signIn(page, admin)
  await page.goto('/admin/tools/site-health')
  await expect(page.getByRole('heading', { name: 'Info', exact: true })).toBeVisible()
  for (const group of [
    'toascribe',
    'Server',
    'Database',
    'Mellomlager',
    'Arbeider',
    'Nettsted',
    'Media',
    'Sikkerhetskopi',
  ]) {
    await expect(page.getByRole('heading', { name: group, exact: true })).toBeVisible()
  }
  await expect(page.getByRole('heading', { name: 'Oppdateringer', exact: true })).toBeVisible()
  await expect(page.getByText('Kjører', { exact: true })).toBeVisible()
  await expectNoAxeViolations(page, 'Site Health → Info')

  await page.getByRole('button', { name: 'Kopier til utklippstavlen' }).click()
  await expect(page.getByText('Informasjonen er kopiert.')).toBeVisible()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toContain('### toascribe\nversion: ')
  expect(copied).toContain('### worker\nstatus: running')
  expect(copied).not.toMatch(/@[\w-]+\.\w/)
  expect(copied).not.toMatch(/\b[a-z]+:\/\//)
  expect(copied).not.toContain('/var/lib')
  expect(copied).not.toContain('/etc/toascribe')
  expect(copied).not.toMatch(/[0-9a-f]{32,}/)
})
