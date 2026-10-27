import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'
import { PHOTO_PNG } from './helpers/images.ts'
import { signIn } from './helpers/screens.ts'
import { createUser } from './helpers/stack.ts'
import type { TestUser } from './helpers/stack.ts'

// The media library (M1.2): an image uploaded on «Legg til ny», given its alternative text in «Vedleggsdetaljer», cropped in «Rediger
// bilde» (the worker makes the new picture: the api answers with its size once it is done), and put in a post from the editor's picker,
// where the block takes the library's alternative text. Each test runs at 375 px and 1280 px; the fixture fails a test on any console
// message or CSP violation, and axe runs on each screen and dialog.

let editor: TestUser

test.beforeAll(async () => {
  editor = await createUser('editor', 'media')
})

test('upload an image, describe it, crop it, and insert it in a post', async ({ page }) => {
  await signIn(page, editor)
  const word = `e2emedia${String(page.viewportSize()?.width ?? 0)}${Date.now().toString(36).slice(-5)}`

  // «Legg til ny»: the limit is shown, the upload goes through the hidden file field of «Velg filer».
  await page.goto('/admin/media/new')
  await expect(page.getByRole('heading', { level: 1, name: 'Last opp ny mediefil' })).toBeVisible()
  await expect(page.getByText(/Maksimal filstørrelse for opplasting: [\d,]+ MB\./)).toBeVisible()
  await expectNoAxeViolations(page, 'Legg til ny')
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: `${word}.png`, mimeType: 'image/png', buffer: PHOTO_PNG })
  await expect(page.getByRole('heading', { name: 'Lastet opp' })).toBeVisible()

  // The library, searched for the file; its details.
  await page.goto('/admin/media')
  await expect(page.getByRole('heading', { level: 1, name: 'Mediebibliotek' })).toBeVisible()
  await page.getByRole('searchbox').fill(word)
  await page.getByRole('button', { name: 'Søk i media' }).click()
  await expect(page.getByText('1 element', { exact: true })).toBeVisible()
  await expectNoAxeViolations(page, 'the library')
  await page.getByRole('button', { name: 'Listevisning' }).click()
  await page.getByRole('button', { name: word, exact: true }).click()
  const details = page.getByRole('dialog', { name: 'Vedleggsdetaljer' })
  await expect(details.getByText('400 × 300 piksler')).toBeVisible()
  await expect(details.getByText('Filen brukes ikke i noe innhold.')).toBeVisible()
  await details.getByLabel('Alternativ tekst').fill(`Blå flate ${word}`)
  await details.getByRole('button', { name: 'Lagre' }).click()
  await expect(details.getByText('Endringene er lagret.')).toBeVisible()
  await expectNoAxeViolations(page, 'Vedleggsdetaljer')

  // «Rediger bilde»: the top-left quarter, typed in; the original is kept. The button waits for the worker's sizes (the window asks
  // again until the file is ready).
  await expect(details.getByRole('button', { name: 'Rediger bilde' })).toBeEnabled({ timeout: 30_000 })
  await details.getByRole('button', { name: 'Rediger bilde' }).click()
  const edit = page.getByRole('dialog', { name: 'Rediger bilde' })
  await edit.getByLabel('Fra venstre').fill('0')
  await edit.getByLabel('Fra toppen').fill('0')
  await edit.getByLabel('Bredde').fill('200')
  await edit.getByLabel('Høyde').fill('150')
  await edit.getByLabel('Høyde').press('Tab')
  await expect(edit.getByText('Resultat: 200 × 150 piksler')).toBeVisible()
  await expectNoAxeViolations(page, 'Rediger bilde')
  await edit.getByRole('button', { name: 'Lagre' }).click()
  await expect(edit).toBeHidden()
  await expect(details.getByText('Bildet lagres. Bildestørrelsene lages på nytt.')).toBeVisible()
  await details.getByRole('button', { name: 'Lukk', exact: true }).last().click()

  // The worker makes the cropped picture; the api then gives its size.
  const listed = await page.request.get(`/api/v1/media?search=${encodeURIComponent(word)}`)
  const { items } = (await listed.json()) as { items: { id: string }[] }
  const id = items[0]?.id ?? ''
  await expect
    .poll(
      async () => {
        const item = (await (await page.request.get(`/api/v1/media/${id}`)).json()) as {
          width: number
          height: number
          processing: string
        }
        return `${item.processing} ${String(item.width)}×${String(item.height)}`
      },
      { timeout: 30_000 },
    )
    .toBe('ready 200×150')

  // A new post: the image block's picker finds the file; the block takes its alternative text.
  await page.goto('/admin/posts/new')
  await page.getByRole('button', { name: 'Legg til blokk' }).last().click()
  await page.getByRole('searchbox', { name: 'Søk etter blokk' }).fill('Bilde')
  await page.getByRole('button', { name: 'Bilde', exact: true }).click()
  await page.getByRole('button', { name: 'Mediebibliotek' }).click()
  const picker = page.getByRole('dialog', { name: 'Velg eller last opp medier' })
  await picker.getByRole('searchbox').fill(word)
  await picker.getByRole('button', { name: 'Søk i media' }).click()
  await expect(picker.getByText('1 element', { exact: true })).toBeVisible()
  await picker.getByRole('button', { name: word, exact: true }).click()
  await expectNoAxeViolations(page, 'the image picker')
  await picker.getByRole('button', { name: 'Velg', exact: true }).click()
  await expect(page.getByLabel('Alternativ tekst')).toHaveValue(`Blå flate ${word}`)
  await expect(page.getByRole('img', { name: `Blå flate ${word}` })).toBeVisible()
  await page.getByRole('textbox', { name: 'Tittel', exact: true }).fill(`${word} med bilde`)
  await page.getByRole('button', { name: 'Lagre kladd' }).click()
  await expect(page.getByText('Lagret.').first()).toBeVisible()

  // «Brukes på» now names the post.
  await page.goto('/admin/media')
  await page.getByRole('searchbox').fill(word)
  await page.getByRole('button', { name: 'Søk i media' }).click()
  await page.getByRole('button', { name: word, exact: true }).first().click()
  await expect(
    page.getByRole('dialog', { name: 'Vedleggsdetaljer' }).getByRole('link', { name: `${word} med bilde` }),
  ).toBeVisible()
})

test('takes a file right at the upload limit through the proxy, and refuses a request above it', async ({ page }) => {
  // The e2e stack runs with TOASCRIBE_UPLOAD_MAX_SIZE_MB=2: the request may be 2 MiB, the file 64 KiB less (the form around it).
  // Caddy and the api both count MiB; with Caddy's `MB` (1000 × 1000) this file would be refused by the proxy.
  test.skip((page.viewportSize()?.width ?? 0) < 1000, 'the limit is the same at every width')
  await signIn(page, editor)
  const limit = 2 * 1024 * 1024 - 64 * 1024
  const pdf = Buffer.alloc(limit, 0x20)
  pdf.write('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n', 0, 'latin1')
  const name = `grense${Date.now().toString(36)}.pdf`
  await page.goto('/admin/media/new')
  // 2 MiB less 64 KiB, as WordPress writes it.
  await expect(page.getByText('Maksimal filstørrelse for opplasting: 1,9 MB.')).toBeVisible()
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: 'application/pdf', buffer: pdf })
  await expect(page.getByRole('heading', { name: 'Lastet opp' })).toBeVisible()
  await expect(page.getByText(name)).toBeVisible()

  // One byte above 2 MiB is refused before it reaches anything that reads it.
  const refused = await page.request.post('/api/v1/media', {
    headers: { 'content-type': 'multipart/form-data; boundary=x' },
    data: Buffer.alloc(2 * 1024 * 1024 + 1),
  })
  expect(refused.status()).toBe(413)
})
