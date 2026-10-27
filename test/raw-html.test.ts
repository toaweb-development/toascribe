// HTML is never rendered unsanitised (security §4; PLAN «Regler for blokker» 2). Block content is data (rich text as nodes and
// marks, @toascribe/blocks), and the views build elements from it, so no Nuxt code has a reason to hand a string to the browser
// as markup. This reads the sources of the Nuxt apps and layers and of the block views (packages/block-views) and fails on `v-html` and
// on writing `innerHTML`/`outerHTML`. One exception, by design (PLAN «Regler for blokker» 2): the view of the custom HTML block writes
// its raw HTML, which only an account with unfiltered_html can put there (the api checks it, @toascribe/blocks permissions.ts).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = new URL('../', import.meta.url)
const DIRS = [
  'packages/nuxt-base/app',
  'apps/site/app',
  'apps/admin/app',
  'themes/default/app',
  'packages/block-views/src',
]

/** The one file allowed an `innerHTML`, and the line it must be on: the custom HTML block's view. */
const CUSTOM_HTML_VIEW = 'packages/block-views/src/render.ts'

function files(relative: string): string[] {
  const start = fileURLToPath(new URL(relative, ROOT))
  if (!existsSync(start)) return []
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (['node_modules', '.nuxt', '.output', 'dist'].includes(entry)) continue
      const full = `${dir}/${entry}`
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(vue|ts)$/.test(entry)) found.push(full)
    }
  }
  walk(start)
  return found
}

describe('no raw HTML in the Nuxt code', () => {
  const sources = DIRS.flatMap(files)

  it('finds the sources, the block views and the editor among them', () => {
    expect(sources.some((file) => file.endsWith('packages/block-views/src/render.ts'))).toBe(true)
    expect(sources.some((file) => file.endsWith('components/blocks/Document.vue'))).toBe(true)
    expect(sources.some((file) => file.endsWith('components/editor/Paragraph.vue'))).toBe(true)
  })

  it.each(sources.map((file) => [file.replace(fileURLToPath(ROOT), ''), file]))(
    '%s has no v-html or innerHTML',
    (_name, file) => {
      let source = readFileSync(file, 'utf8')
      if (file.endsWith(CUSTOM_HTML_VIEW)) {
        // Exactly one, in the branch of core/html, and that branch is what is taken out before the checks below.
        // ... and only after the branch that shows the source unless the caller asked for `raw`.
        const allowed =
          /\n {4}case HTML:\n {6}if \(context\.html !== 'raw'\) \{\n.*\n {6}\}\n(?: {6}\/\/.*\n)* {6}return h\('div', \{ class: 'block-html', innerHTML: text\(block, 'content'\) \}\)\n/
        expect(source).toMatch(allowed)
        source = source.replace(allowed, '\n')
      }
      expect(source).not.toMatch(/\bv-html\b/)
      // `:innerHTML` in a template is v-html by another name, and `innerHTML +=` or an `innerHTML` prop in h() too.
      expect(source).not.toMatch(/\b(inner|outer)HTML\b/)
      // TipTap parses a string given to setContent or insertContent as HTML; the editor only ever hands it JSON.
      expect(source).not.toMatch(/\b(setContent|insertContent)\(\s*['"`]/)
      // Other ways to write markup from a string (security §4).
      expect(source).not.toMatch(
        /insertAdjacentHTML|document\.write\(|createStaticVNode|createContextualFragment|\bsrcdoc\b/,
      )
      // Raw custom HTML is for the public site's templates (M1.4); no admin code asks for it (its scripts would get the nonce).
      if (file.includes('/apps/admin/') || file.includes('/packages/nuxt-base/')) {
        expect(source).not.toMatch(/html[=:]\s*["']raw["']/)
      }
    },
  )
})
