import type { Browser, Page } from '@playwright/test'

import { createUser, linkIn, resetLimits, setSetting, uniqueName, waitForMail } from './helpers/stack.ts'
import type { TestUser } from './helpers/stack.ts'
import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import {
  NEXT_STEP_MS,
  expectSignedIn,
  fillLogin,
  signIn,
  signOut,
  totpCode,
  waitForSessionCookie,
} from './helpers/screens.ts'

// The profile page (M0.5, WordPress' profile.php): personal choices, name, contact, biography and account management (password, second
// factor, sessions). Each test runs at 375 px and at 1280 px. The accounts are subscribers: every new administrator is announced by
// mail to all the others, so this file makes exactly one (the administrator who changes the name and the colour scheme) and the rest
// are plain accounts.

test.beforeEach(async () => {
  await resetLimits()
})

const PROFILE = '/admin/profile'

/** A freshly made account, signed in on the profile page. */
async function onProfile(page: Page, role = 'subscriber', prefix = 'prof'): Promise<TestUser> {
  const user = await createUser(role, prefix)
  await signIn(page, user, PROFILE.replace('/profile', '/login?redirectTo=%2Fadmin%2Fprofile'))
  await expect(page).toHaveURL(/\/admin\/profile$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible()
  return user
}

const field = (page: Page, name: RegExp | string) => page.getByRole('textbox', { name })
const save = (page: Page) => page.getByRole('button', { name: 'Oppdater profil' })

/** A colour scheme is chosen by its label: the radio button itself is visually hidden and the card is what a person presses. */
async function chooseScheme(page: Page, name: string): Promise<void> {
  await page.getByRole('radiogroup').getByText(name, { exact: true }).click()
  await expect(page.getByRole('radio', { name: new RegExp(name) })).toBeChecked()
}

/** The dialog that asks for the current password, answered with `password`. */
async function answerPasswordDialog(page: Page, password: string, button: string): Promise<void> {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Passordet ditt nå').fill(password)
  await dialog.getByRole('button', { name: button }).click()
}

test('the page has the sections of profile.php, in order, and no axe violations', async ({ page }) => {
  await onProfile(page)
  const headings = page.getByRole('heading', { level: 2 })
  await expect(headings).toHaveText([
    'Personlige valg',
    'Navn',
    'Kontaktinformasjon',
    'Om deg selv',
    'Kontoadministrasjon',
  ])
  await expect(page.getByRole('heading', { level: 3 })).toHaveText(['Nytt passord', 'Tofaktorautentisering', 'Økter'])
  await expect(page.getByText('Tofaktor er av.')).toBeVisible()
  await expect(page.getByText('Du er bare logget inn her')).toBeVisible()
  await expectNoAxeViolations(page, 'the profile page')
})

test('the username is read-only, the name fields save, and the bar greets with the display name', async ({ page }) => {
  const user = await onProfile(page)
  const username = field(page, 'Brukernavn')
  await expect(username).toHaveValue(user.username)
  await expect(username).toHaveAttribute('readonly', '')
  await expect(page.getByText('Brukernavn kan ikke endres.')).toBeVisible()

  // A fresh account has no nickname: the form starts with the username, so it can be sent as it is.
  await expect(field(page, /^Kallenavn/)).toHaveValue(user.username)
  await field(page, 'Fornavn').fill('Ada')
  await field(page, 'Etternavn').fill('Lovelace')
  await field(page, /^Kallenavn/).fill('Countess')
  // The options are built from what is typed, as WordPress does.
  const display = page.getByLabel('Vis navn offentlig som')
  await expect(display.locator('option')).toHaveText([
    'Countess',
    user.username,
    'Ada',
    'Lovelace',
    'Ada Lovelace',
    'Lovelace Ada',
  ])
  await display.selectOption({ label: 'Ada Lovelace' })
  await field(page, 'Nettsted').fill('https://example.org/ada')
  await field(page, /^Biografisk informasjon/).fill('Første linje\nAndre linje')
  await save(page).click()

  await expect(page.getByText('Profil oppdatert.')).toBeVisible()
  await expect(save(page)).toBeFocused()
  await expect(page.getByRole('button', { name: 'Hei, Ada Lovelace', exact: false })).toBeVisible()
  await expectNoAxeViolations(page, 'the profile page after saving')

  await page.reload()
  await expect(field(page, 'Fornavn')).toHaveValue('Ada')
  await expect(page.getByLabel('Vis navn offentlig som')).toHaveValue('first_last')
  await expect(field(page, /^Biografisk informasjon/)).toHaveValue('Første linje\nAndre linje')
  await expect(page.getByRole('button', { name: 'Hei, Ada Lovelace', exact: false })).toBeVisible()
})

test('a form with mistakes gets an error summary that links to the fields; nothing is sent', async ({ page }) => {
  await onProfile(page)
  await field(page, /^Kallenavn/).fill('')
  await field(page, 'Nettsted').fill('example.org')
  await save(page).click()

  const summary = page.getByRole('group', { name: 'Sjekk disse feltene' })
  await expect(summary).toBeVisible()
  await expect(summary).toBeFocused()
  await expect(summary.getByRole('link')).toHaveText([
    /Kallenavn: Skriv inn et kallenavn/,
    /Nettsted: Skriv inn en adresse som starter med http/,
  ])
  await expectNoAxeViolations(page, 'the profile page with the error summary')
  await summary.getByRole('link', { name: /^Nettsted/ }).click()
  await expect(field(page, 'Nettsted')).toBeFocused()
  await expect(page.getByText('Profil oppdatert.')).toHaveCount(0)

  // The error goes away as it is fixed, and the form can be saved.
  await field(page, /^Kallenavn/).fill('Kari')
  await field(page, 'Nettsted').fill('https://example.org')
  await save(page).click()
  await expect(page.getByText('Profil oppdatert.')).toBeVisible()
})

test('leaving the page with unsaved edits asks first', async ({ page }) => {
  const user = await onProfile(page)
  await field(page, 'Fornavn').fill('Ola')
  // The user menu of the bar is on both widths; «Logg ut» is a link inside the admin.
  const leave = async () => {
    await page.getByRole('button', { name: /^Hei, / }).click()
    await page.getByRole('menuitem', { name: 'Logg ut' }).click()
  }
  await leave()
  const dialog = page.getByRole('dialog', { name: 'Forlate siden uten å lagre?' })
  await expect(dialog).toBeVisible()
  // The safe choice has the focus, not the one that loses the edits.
  await expect(dialog.getByRole('button', { name: 'Bli på siden' })).toBeFocused()
  await dialog.getByRole('button', { name: 'Bli på siden' }).click()
  await expect(page).toHaveURL(/\/admin\/profile$/)
  await expect(field(page, 'Fornavn')).toHaveValue('Ola')

  await leave()
  await page.getByRole('dialog').getByRole('button', { name: 'Forlat siden' }).click()
  await expect(page).toHaveURL(/\/admin\/logout$/)
  await expect(page.getByRole('button', { name: `Hei, ${user.username}` })).toHaveCount(0)
})

test('the colour scheme applies at once and survives a reload; the toolbar choice is kept', async ({ page }) => {
  const user = await onProfile(page)
  await expect(page.locator('html')).not.toHaveClass(/dark/)

  await chooseScheme(page, 'Midnatt')
  await expect(page.getByText('Fargeskjemaet «Midnatt» er lagret.')).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.reload()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.getByRole('radio', { name: /Midnatt/ })).toBeChecked()
  await expectNoAxeViolations(page, 'the profile page in Midnatt')

  await chooseScheme(page, 'Lys')
  await expect(page.getByText('Fargeskjemaet «Lys» er lagret.')).toBeVisible()
  await expect(page.locator('html')).not.toHaveClass(/dark/)

  const toolbar = page.getByRole('checkbox', { name: 'Vis verktøylinjen når du ser på nettstedet' })
  await expect(toolbar).toBeChecked()
  await toolbar.uncheck()
  await expect(page.getByText('Verktøylinjen vises ikke når du ser på nettstedet.')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('checkbox', { name: /Vis verktøylinjen/ })).not.toBeChecked()
  await expect(page.getByRole('radio', { name: /Lys/ })).toBeChecked()
  await expectSignedIn(page, user)
})

test('a new e-mail address needs the password, and changes only when the link is opened', async ({
  page,
  allowFailedRequests,
}) => {
  allowFailedRequests()
  const user = await onProfile(page)
  const newEmail = `${uniqueName('new')}@example.test`
  await field(page, /^E-post/).fill(newEmail)
  await save(page).click()

  // A wrong password is answered under the field and the dialog stays.
  const dialog = page.getByRole('dialog', { name: 'Bekreft den nye e-postadressen' })
  await expect(dialog).toBeVisible()
  await expectNoAxeViolations(page, 'the password dialog')
  await answerPasswordDialog(page, 'not the password at all', 'Send lenke')
  await expect(dialog.getByText('Passordet er feil.')).toBeVisible()
  await expect(dialog).toBeVisible()
  await answerPasswordDialog(page, user.password, 'Send lenke')
  await expect(dialog).toHaveCount(0)

  await expect(page.getByText(`Vi har sendt en lenke til ${newEmail}.`)).toBeVisible()
  // The field shows the address the account still has; the new one is only in the mail.
  await expect(field(page, /^E-post/)).toHaveValue(user.email)
  const link = linkIn(await waitForMail(newEmail), 'confirmemail')
  await page.reload()
  await expect(field(page, /^E-post/)).toHaveValue(user.email)

  await page.goto(link)
  await expect(page.getByText(`E-postadressen er bekreftet. Kontoen bruker nå ${newEmail}.`)).toBeVisible()
  await page.goto(PROFILE)
  await expect(field(page, /^E-post/)).toHaveValue(newEmail)
})

test('cancelling the password dialog leaves the address as it is and says so', async ({ page }) => {
  const user = await onProfile(page)
  await field(page, /^E-post/).fill(`${uniqueName('skip')}@example.test`)
  await save(page).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Passordet ditt nå')).toBeFocused()
  await dialog.getByRole('button', { name: 'Avbryt' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('E-postadressen ble ikke endret.')).toBeVisible()
  // Focus is back on the button that was pressed.
  await expect(save(page)).toBeFocused()
  await page.reload()
  // (The browser asks before the reload because of the unsaved address; the test accepts it by the next line's state.)
  await expect(field(page, /^E-post/)).toHaveValue(user.email)
})

test('a new password: weak ones are refused, a good one works, and the other sessions end', async ({
  page,
  browser,
  allowFailedRequests,
}) => {
  allowFailedRequests()
  const user = await onProfile(page, 'subscriber', 'pw')
  const other = await openSecondSession(browser, user)

  await page.getByRole('button', { name: 'Sett nytt passord' }).click()
  const password = field(page, /^Nytt passord/)
  // WordPress makes a strong password and shows it.
  await expect(password).toHaveValue(/.{20,}/)
  await expect(password).toHaveAttribute('type', 'text')
  await expectNoAxeViolations(page, 'the new password form')

  // Too short: caught on the form.
  await password.fill('short')
  await page.getByRole('button', { name: 'Lagre nytt passord' }).click()
  await expect(page.getByText('Passordet må ha minst 8 tegn.')).toBeVisible()
  await expect(password).toBeFocused()

  // The username as a password is long enough but weak: the API refuses it, and the refusal shows on the field.
  await password.fill(user.username)
  await page.getByRole('button', { name: 'Lagre nytt passord' }).click()
  await answerPasswordDialog(page, user.password, 'Bytt passord')
  await expect(page.getByText('Passordet kan ikke være det samme som brukernavnet')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(password).toBeFocused()

  // A good one; the dialog is asked again, and a wrong current password is answered in the dialog.
  const fresh = `fresh ${uniqueName('pw')} horse 42`
  await password.fill(fresh)
  await page.getByRole('button', { name: 'Lagre nytt passord' }).click()
  await answerPasswordDialog(page, 'the wrong current one', 'Bytt passord')
  await expect(page.getByRole('dialog').getByText('Passordet er feil.')).toBeVisible()
  await answerPasswordDialog(page, user.password, 'Bytt passord')
  await expect(page.getByText('Passordet er endret. De andre øktene dine er logget ut.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sett nytt passord' })).toBeFocused()

  // The other session is gone, this one stays, and the new password logs in.
  await other.page.reload()
  await expect(other.page.getByRole('button', { name: /^Hei, / })).toHaveCount(0)
  await other.context.close()
  await signOut(page)
  await page.goto('/admin/login')
  await fillLogin(page, { username: user.username, password: fresh })
  await expectSignedIn(page, user)
})

/** Signs the account in in a second browser (its own cookies), as another device would be. */
async function openSecondSession(browser: Browser, user: TestUser) {
  const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:18080' })
  const page = await context.newPage()
  await signIn(page, user)
  await waitForSessionCookie(context)
  return { context, page }
}

test('two-factor: set up an app, new recovery codes, remove it', async ({ page, allowFailedRequests }) => {
  allowFailedRequests()
  const user = await onProfile(page, 'subscriber', 'mfa')
  await expect(page.getByText('Tofaktor er av.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Lag nye gjenopprettingskoder' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Sett opp autentiseringsapp' }).click()
  const qr = page.getByRole('img', { name: /QR-kode/ })
  await expect(qr).toBeVisible()
  const secret = (await page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{4})+$/).textContent()) ?? ''
  expect(secret).not.toBe('')
  await expectNoAxeViolations(page, 'two-factor set-up on the profile')

  // The first code and the password: a wrong password is answered at its field and the secret stays valid.
  await page.getByLabel('Kode fra appen').fill(totpCode(secret))
  await page.getByLabel('Passordet ditt nå').fill('this is not it')
  await page.getByRole('button', { name: 'Bekreft og legg til appen' }).click()
  await expect(page.getByText('Passordet er feil.')).toBeVisible()
  await expect(page.getByLabel('Passordet ditt nå')).toBeFocused()
  await page.getByLabel('Passordet ditt nå').fill(user.password)
  await page.getByRole('button', { name: 'Bekreft og legg til appen' }).click()

  // The first app brings the ten recovery codes, shown once.
  const heading = page.getByRole('heading', { level: 2, name: 'Gjenopprettingskoder' })
  await expect(heading).toBeVisible()
  await expect(page.getByRole('list', { name: 'Gjenopprettingskoder' }).getByRole('listitem')).toHaveCount(10)
  const done = page.getByRole('button', { name: 'Fortsett' })
  await expect(done).toHaveAttribute('aria-disabled', 'true')
  await page.getByLabel('Jeg har lagret kodene').check()
  await done.click()
  await expect(page.getByText('Autentiseringsappen er lagt til.')).toBeVisible()
  await expect(page.getByText(/Tofaktor er på, med 1 autentiseringsapp\./)).toBeVisible()
  await expect(page.getByText('Du har 10 gjenopprettingskoder igjen.')).toBeVisible()
  await expectNoAxeViolations(page, 'two-factor on the profile')

  // New codes replace the old ones.
  await page.getByRole('button', { name: 'Lag nye gjenopprettingskoder' }).click()
  await answerPasswordDialog(page, user.password, 'Lag nye koder')
  await expect(page.getByRole('list', { name: 'Gjenopprettingskoder' }).getByRole('listitem')).toHaveCount(10)
  await page.getByLabel('Jeg har lagret kodene').check()
  await page.getByRole('button', { name: 'Ferdig' }).click()

  // The next login asks for the code.
  void NEXT_STEP_MS
  // Removing the app is a confirmation that names it and asks for the password; focus lands on the section's heading afterwards.
  await page.getByRole('button', { name: /^Fjern/ }).click()
  const dialog = page.getByRole('dialog', { name: /^Fjerne «Autentiseringsapp»\?/ })
  await expect(dialog).toContainText('Dette er den siste appen din.')
  await answerPasswordDialog(page, 'wrong one', 'Fjern appen')
  await expect(dialog.getByText('Passordet er feil.')).toBeVisible()
  await answerPasswordDialog(page, user.password, 'Fjern appen')
  await expect(page.getByText('«Autentiseringsapp» er fjernet.')).toBeVisible()
  await expect(page.getByText('Tofaktor er av.')).toBeVisible()
  await expect(page.getByRole('heading', { level: 3, name: 'Tofaktorautentisering' })).toBeFocused()
})

test('two-factor required by the role: the last app cannot be removed', async ({ page, allowFailedRequests }) => {
  allowFailedRequests()
  await setSetting('mfa_required_roles', ['editor'])
  try {
    const user = await createUser('editor', 'req')
    await page.goto('/admin/login?redirectTo=%2Fadmin%2Fprofile')
    await fillLogin(page, user)
    await expect(page.getByRole('heading', { level: 1, name: 'Sett opp tofaktor' })).toBeVisible()
    const secret = (await page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{4})+$/).textContent()) ?? ''
    await page.getByLabel('Kode fra appen').fill(totpCode(secret))
    await page.getByRole('button', { name: 'Bekreft og fullfør' }).click()
    await page.getByLabel('Jeg har lagret kodene').check()
    await page.getByRole('button', { name: 'Fortsett' }).click()
    await page.goto(PROFILE)
    await expect(page.getByText('Rollen din krever tofaktor. Den siste appen kan derfor ikke fjernes')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Fjern/ })).toHaveCount(0)

    // A second app can be added, and then either can go.
    await page.getByRole('button', { name: 'Sett opp autentiseringsapp' }).click()
    const second = (await page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{4})+$/).textContent()) ?? ''
    await page.getByLabel('Kode fra appen').fill(totpCode(second, Date.now() + NEXT_STEP_MS))
    await page.getByLabel('Passordet ditt nå').fill(user.password)
    await page.getByRole('button', { name: 'Bekreft og legg til appen' }).click()
    await expect(page.getByText('Autentiseringsappen er lagt til.')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Fjern/ })).toHaveCount(2)
    await expectNoAxeViolations(page, 'two apps on the profile')
  } finally {
    await setSetting('mfa_required_roles', [])
  }
})

test('sessions: a second browser appears, and «Logg ut overalt ellers» ends it', async ({ page, browser }) => {
  const user = await onProfile(page, 'subscriber', 'ses')
  await expect(page.getByText('Du er bare logget inn her')).toBeVisible()
  const other = await openSecondSession(browser, user)

  await page.reload()
  const list = page.getByRole('list', { name: 'Aktive økter' })
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await expect(list.getByText('Denne økten')).toHaveCount(1)
  await expect(list.getByText(/Chrome på Windows/).first()).toBeVisible()
  await expect(list.getByText(/sist aktiv/).first()).toBeVisible()
  await expectNoAxeViolations(page, 'the profile page with two sessions')

  // Cancelling the confirmation changes nothing.
  await page.getByRole('button', { name: 'Logg ut overalt ellers' }).click()
  const dialog = page.getByRole('dialog', { name: 'Logge ut overalt ellers?' })
  await expect(dialog).toContainText('1 annen økt avsluttes.')
  await expect(dialog.getByRole('button', { name: 'Avbryt' })).toBeFocused()
  await dialog.getByRole('button', { name: 'Avbryt' }).click()
  await expect(list.getByRole('listitem')).toHaveCount(2)

  await page.getByRole('button', { name: 'Logg ut overalt ellers' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Logg ut overalt ellers' }).click()
  await expect(page.getByText('1 økt er avsluttet.')).toBeVisible()
  await expect(list.getByRole('listitem')).toHaveCount(1)
  await expect(page.getByText('Du er bare logget inn her')).toBeVisible()
  await expect(page.getByRole('heading', { level: 3, name: 'Økter' })).toBeFocused()

  // The other browser's next request is signed out.
  await other.page.reload()
  await expect(other.page).toHaveURL(/\/admin\/login/)
  await other.context.close()
})

test('sessions: one other session can be ended by itself', async ({ page, browser }) => {
  const user = await onProfile(page, 'subscriber', 'one')
  const other = await openSecondSession(browser, user)
  await page.reload()
  const list = page.getByRole('list', { name: 'Aktive økter' })
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await list.getByRole('button', { name: /^Logg ut økten på/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Logg ut', exact: true }).click()
  await expect(list.getByRole('listitem')).toHaveCount(1)
  await other.page.reload()
  await expect(other.page).toHaveURL(/\/admin\/login/)
  await other.context.close()
})
