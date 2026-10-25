import { readFile } from 'node:fs/promises'

import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { expectSignedIn } from './helpers/screens.ts'
import { compose, resetWizardStack, serviceLog, setupTokenFromLog, waitForMail, wizardStack } from './helpers/stack.ts'
import type { Page } from '@playwright/test'

// The setup wizard (M0.4), from an empty database to a signed-in administrator. It has a stack of its own (another project
// name and ports, `WIZARD_STACK_ENV`), which is taken down with its volumes and started again before each width, because an
// installed site cannot be installed twice. The tests run in order and share that one run of the wizard:
//
//   1. before the install every page goes to the wizard, with the code in the fragment of the address kept through the redirects and then taken out of the address bar;
//   2. the seven steps, with axe on each, a test mail that reaches Mailpit and the recovery key saved as a file;
//   3. after the install the wizard is a 404, the site is open and has the default content, and the code is nowhere in the logs.
//
// The suite fails on any console error or warning and on any CSP violation (helpers/fixtures.ts), so «the download works under
// the strict CSP» is proved by the key being saved here with that guard on.

const stack = wizardStack()
test.use({ baseURL: stack.baseUrl })
test.describe.configure({ mode: 'serial' })

const SITE_TITLE = 'Kaffekroken'
const ADMIN = { username: 'kari', email: 'kari@example.test', password: 'correct horse battery 42' }
const TEST_MAIL_TO = 'owner@example.test'
const RECOVERY_KEY = /^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){7}$/

let setupToken = ''

test.beforeAll(async () => {
  test.setTimeout(900_000)
  await resetWizardStack()
  setupToken = await setupTokenFromLog(stack)
})

/** The step the wizard is on, by the heading it moves focus to. */
async function expectStep(page: Page, n: number, title: string): Promise<void> {
  await expect(page.getByRole('heading', { level: 2, name: new RegExp(`^Steg ${n} av 7: ${title}`) })).toBeVisible()
}

async function sessionStorageHolds(page: Page, value: string): Promise<boolean> {
  return page.evaluate((needle) => {
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index) ?? ''
      if ((window.sessionStorage.getItem(key) ?? '').includes(needle)) {
        return true
      }
    }
    return false
  }, value)
}

test('before the install every page goes to the wizard, and a wrong code is refused', async ({
  page,
  request,
  allowFailedRequests,
}) => {
  allowFailedRequests()

  // The first request is answered with a redirect, so the page that was asked for is never drawn.
  const first = await request.get('/', { maxRedirects: 0 })
  expect(first.status()).toBe(302)
  expect(first.headers().location).toMatch(/\/admin\/setup$/)

  await page.goto('/')
  await expect(page).toHaveURL(/\/admin\/setup$/)
  await page.goto('/admin/login')
  await expect(page).toHaveURL(/\/admin\/setup$/)
  await page.goto('/admin/login?redirectTo=%2Fadmin')
  await expect(page).toHaveURL(/\/admin\/setup$/)

  // A code in the query is not read and not passed on: the redirect carries nothing of the address.
  await page.goto('/?token=abc')
  await expect(page).toHaveURL(/\/admin\/setup$/)

  await page.goto('/admin/setup')
  await expectStep(page, 1, 'Oppsettskode')
  await expect(page.getByText('docker compose logs api')).toBeVisible()
  await expectNoAxeViolations(page, 'wizard, step 1 (code form)')

  await page.getByRole('textbox', { name: 'Oppsettskode' }).fill('not-the-code-at-all-1234567890')
  await page.getByRole('button', { name: 'Kontroller koden' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/setup$/)
})

test('a code in the fragment survives the redirects to the wizard, and a code in the query is not read', async ({
  context,
  request,
}) => {
  test.setTimeout(120_000)

  // The server never sees a fragment, so the redirect cannot carry it; the browser keeps it across a `Location` without one
  // (the proxy's 308 for /setup and the app's 302 for the other pages). Each page is a new tab, so none starts with a code in
  // its session storage.
  for (const start of ['/', '/admin/login', '/admin/login?redirectTo=%2Fadmin', '/setup', '/blog']) {
    const tab = await context.newPage()
    await tab.goto(`${start}#token=${setupToken}`)
    await expectStep(tab, 2, 'Sjekk av systemet')
    expect(tab.url(), start).toMatch(/\/admin\/setup$/)
    expect(await sessionStorageHolds(tab, setupToken), start).toBe(true)
    await tab.close()
  }

  // A code in the query is neither used nor kept: the wizard asks for it on the first step.
  const queried = await context.newPage()
  // The rejected parameter is taken out of the address bar (router.replace, no history entry); another parameter stays.
  await queried.goto(`/admin/setup?token=${setupToken}&keep=1`)
  await expectStep(queried, 1, 'Oppsettskode')
  await expect(queried).toHaveURL(/\/admin\/setup\?keep=1$/)
  expect(queried.url()).not.toContain(setupToken)
  expect(await queried.evaluate(() => window.history.length)).toBeLessThanOrEqual(2)
  expect(await sessionStorageHolds(queried, setupToken)).toBe(false)
  await queried.close()

  // The pages the server draws never hold the code: it is not in the request the server gets.
  for (const path of ['/admin/setup', '/']) {
    const response = await request.get(path, { maxRedirects: 0 })
    expect(await response.text()).not.toContain(setupToken)
    expect(JSON.stringify(response.headers())).not.toContain(setupToken)
  }
})

test('the seven steps, from the code in the address to the administrator signed in', async ({
  page,
  context,
  allowFailedRequests,
}) => {
  test.setTimeout(240_000)
  // The install is refused once on purpose (a weak password), and the browser logs a 400 as an error.
  allowFailedRequests()

  // The number of history entries of a tab that opened the wizard without a code: the baseline for «no extra entry».
  const plain = await context.newPage()
  await plain.goto('/admin/setup')
  const baseline = await plain.evaluate(() => window.history.length)
  await plain.close()

  // 1. The code arrives in the fragment of the address, is moved into this tab and taken out of the address bar, without a
  // history entry. The page the server drew did not have it (a fragment is never sent), and the page now does not show it.
  await page.goto(`/admin/setup#token=${setupToken}`)
  await expectStep(page, 2, 'Sjekk av systemet')
  expect(page.url()).toMatch(/\/admin\/setup$/)
  expect(page.url()).not.toContain(setupToken)
  expect(await page.evaluate(() => window.location.hash)).toBe('')
  expect(await sessionStorageHolds(page, setupToken)).toBe(true)
  expect(await page.evaluate(() => window.history.length)).toBe(baseline)
  expect(await page.content()).not.toContain(setupToken)

  // 2. The system check.
  await expect(page.getByText('Sjekken er ferdig, og alt som må være i orden, er det.')).toBeVisible()
  await expect(page.getByText(`Nettleseren bruker ${stack.baseUrl}`)).toBeVisible()
  await expect(page.getByText('Databasen svarer.')).toBeVisible()
  await expectNoAxeViolations(page, 'wizard, step 2 (system check)')

  // A reload keeps the position and the code (it is in this tab's storage, not in the address).
  await page.reload()
  await expectStep(page, 2, 'Sjekk av systemet')
  await page.getByRole('button', { name: 'Fortsett' }).click()

  // 3. The site.
  await expectStep(page, 3, 'Om nettstedet')
  await expect(page.getByLabel('Tidssone')).toContainText('Europe/Oslo')
  await expectNoAxeViolations(page, 'wizard, step 3 (site)')
  await page.getByRole('button', { name: 'Fortsett' }).click()
  await expect(page.getByText('Skriv inn en tittel for nettstedet')).toBeVisible()
  await page.getByLabel('Nettstedstittel').fill(SITE_TITLE)
  await page.getByLabel('Tidssone').click()
  await page.getByPlaceholder('Søk etter tidssone').fill('Stockholm')
  await page.getByRole('option', { name: 'Europe/Stockholm' }).click()
  await page.getByLabel('E-postadresse for administrasjon').fill(ADMIN.email)
  await page.getByLabel('Be søkemotorer om ikke å indeksere dette nettstedet').check()
  await page.getByRole('button', { name: 'Fortsett' }).click()

  // The saved steps are read again after a reload: this one is done, so the wizard is on the next.
  await expectStep(page, 4, 'E-post')
  await page.reload()
  await expectStep(page, 4, 'E-post')

  // 4. E-mail: it cannot be passed before a test mail has gone, then Mailpit gets the test mail.
  await expectNoAxeViolations(page, 'wizard, step 4 (e-mail)')
  await page.getByRole('button', { name: 'Fortsett' }).click({ force: true })
  await expectStep(page, 4, 'E-post')
  await page.getByLabel('SMTP-server').fill('mailpit')
  await page.getByLabel('Kryptering').click()
  await page.getByRole('option', { name: /^Ingen/ }).click()
  await page.getByLabel('Port', { exact: true }).fill('1025')
  await page.getByLabel('Avsenderadresse').fill('toascribe@example.test')
  await page.getByLabel('Send test-e-post til').fill(TEST_MAIL_TO)
  await page.getByRole('button', { name: 'Send test-e-post' }).click()
  await expect(page.getByText(`Test-e-posten er sendt til ${TEST_MAIL_TO}.`)).toBeVisible({ timeout: 45_000 })
  const mail = await waitForMail(TEST_MAIL_TO, undefined, stack)
  expect(mail.length).toBeGreaterThan(0)
  await expectNoAxeViolations(page, 'wizard, step 4 (test mail sent)')
  await page.getByRole('button', { name: 'Fortsett' }).click()

  // 5. The first administrator, and the recovery key.
  await expectStep(page, 5, 'Første administrator')
  await expectNoAxeViolations(page, 'wizard, step 5 (account)')
  await page.getByLabel('Brukernavn', { exact: true }).fill(ADMIN.username)
  await page.getByLabel('E-postadresse', { exact: true }).fill(ADMIN.email)
  // A password that is the e-mail address is refused by the form, before any key is made.
  await page.getByLabel('Passord', { exact: true }).fill(ADMIN.email)
  await page.getByRole('button', { name: 'Fortsett til gjenopprettingsnøkkelen' }).click()
  await expect(page.getByText('Passordet kan ikke være det samme som brukernavnet eller e-postadressen.')).toBeVisible()
  await expect(page.getByTestId('recovery-key')).toHaveCount(0)

  // The api says no to such a password too (400 `weak_password`, tested against the real api in apps/api). Here the answer is
  // played once, to see what the wizard does with it: back on this step with the reason, the code and the saved steps kept, and
  // what was typed still there.
  await page.getByLabel('Passord', { exact: true }).fill(ADMIN.password)
  await page.getByRole('button', { name: 'Fortsett til gjenopprettingsnøkkelen' }).click()
  await expect(page.getByTestId('recovery-key')).toBeVisible()
  await page.getByLabel('Jeg har lagret gjenopprettingsnøkkelen').check()
  await page.getByRole('button', { name: 'Fortsett' }).click()
  await expectStep(page, 6, 'Standardinnhold')
  await page.getByRole('button', { name: 'Fortsett' }).click()
  await expectStep(page, 7, 'Fullfør installasjonen')
  await page.route(
    '**/api/v1/setup/install',
    (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'weak_password', message: 'weak', requestId: 'e2e' } }),
      }),
    { times: 1 },
  )
  await page.getByRole('button', { name: 'Fullfør installasjonen' }).click()
  await expectStep(page, 5, 'Første administrator')
  await expect(
    page.getByRole('alert').filter({ hasText: 'Passordet kan ikke være det samme som brukernavnet' }),
  ).toBeVisible()
  expect(await sessionStorageHolds(page, setupToken)).toBe(true)
  await expect(page.getByLabel('Brukernavn', { exact: true })).toHaveValue(ADMIN.username)
  await expectNoAxeViolations(page, 'wizard, step 5 (weak password refused)')
  await page.getByLabel('Passord', { exact: true }).fill(ADMIN.password)
  await page.getByRole('button', { name: 'Fortsett til gjenopprettingsnøkkelen' }).click()

  const key = page.getByTestId('recovery-key')
  await expect(key).toBeVisible()
  const shownKey = (await key.textContent())?.trim() ?? ''
  expect(shownKey).toMatch(RECOVERY_KEY)
  await expectNoAxeViolations(page, 'wizard, step 5 (recovery key)')

  // Not past the key before the box is ticked.
  await page.getByRole('button', { name: 'Fortsett' }).click({ force: true })
  await expect(page.getByText('Bekreft at du har lagret nøkkelen for å gå videre.')).toBeVisible()
  await expect(key).toBeVisible()

  // The file is saved under the strict CSP (the fixtures fail the test on any violation).
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Last ned som tekstfil' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe('toascribe-recovery-key.txt')
  const path = await download.path()
  const text = await readFile(path, 'utf8')
  expect(text).toContain(shownKey)
  expect(text).toContain(SITE_TITLE)
  await expect(page.getByText('Tekstfilen er lastet ned.')).toBeVisible()

  await page.getByLabel('Jeg har lagret gjenopprettingsnøkkelen').check()
  await page.getByRole('button', { name: 'Fortsett' }).click()

  // 6. The default content: nothing to fill in.
  await expectStep(page, 6, 'Standardinnhold')
  await expect(page.getByText('«Hei, verden!»')).toBeVisible()
  await expectNoAxeViolations(page, 'wizard, step 6 (content)')
  await page.getByRole('button', { name: 'Fortsett' }).click()

  // 7. Finish: what will be set up, then the install, and the administrator is signed in.
  await expectStep(page, 7, 'Fullfør installasjonen')
  await expect(page.getByText(SITE_TITLE, { exact: true })).toBeVisible()
  await expect(page.getByText('Europe/Stockholm')).toBeVisible()
  await expect(page.getByText(`${ADMIN.username} (${ADMIN.email})`)).toBeVisible()
  await expectNoAxeViolations(page, 'wizard, step 7 (finish)')
  await page.getByRole('button', { name: 'Fullfør installasjonen' }).click()

  await expect(page).toHaveURL(/\/admin\/?$/, { timeout: 60_000 })
  await expectSignedIn(page, ADMIN)
  expect((await context.cookies()).some((cookie) => cookie.name === '__Host-toa_session')).toBe(true)
  expect(await sessionStorageHolds(page, setupToken)).toBe(false)
  await expectNoAxeViolations(page, 'the admin index after the install')
})

test('after the install the wizard is a 404, the site is open and has the default content, and the code is in no log but the first line', async ({
  page,
  request,
  allowFailedRequests,
}) => {
  allowFailedRequests()

  const wizard = await request.get('/admin/setup')
  expect(wizard.status()).toBe(404)
  const through = await request.get('/', { maxRedirects: 0 })
  expect(through.status()).toBe(200)

  await page.goto('/admin/setup')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expectNoAxeViolations(page, 'the 404 page of the wizard address')

  // The public site is no longer sent to the wizard. It has no page for posts yet (phase 1), so the default content is read from
  // the database.
  await page.goto('/')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const titles = await compose(
    [
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'toascribe',
      '-At',
      '-c',
      'select title from content order by title',
    ],
    undefined,
    stack,
  )
  expect(titles).toContain('Hei, verden!')
  expect(titles).toContain('Testside')

  // The setup code is logged once, by the api at start-up, on purpose. Not by anything else, and not by the proxy that saw the
  // address it came in.
  const occurrences = async (service: string): Promise<number> =>
    (await serviceLog(service, stack)).split(setupToken).length - 1
  expect(await occurrences('api')).toBe(1)
  expect(await occurrences('worker')).toBe(0)
  expect(await occurrences('admin')).toBe(0)
  expect(await occurrences('site')).toBe(0)
  expect(await occurrences('proxy')).toBe(0)
})
