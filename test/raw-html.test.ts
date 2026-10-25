// HTML is never rendered unsanitised (security §4; PLAN «Regler for blokker» 2). Block content is data (rich text as nodes and
// marks, @toascribe/blocks), and the views build elements from it, so no Nuxt code has a reason to hand a string to the browser
// as markup. This reads the sources of the Nuxt apps and layers and fails on `v-html` and on writing `innerHTML`/`outerHTML`.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = new URL('../', import.meta.url)
const DIRS = ['packages/nuxt-base/app', 'apps/site/app', 'apps/admin/app', 'themes/default/app']

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
    expect(sources.some((file) => file.endsWith('components/blocks/RichTextNode.vue'))).toBe(true)
    expect(sources.some((file) => file.endsWith('components/editor/Paragraph.vue'))).toBe(true)
  })

  it.each(sources.map((file) => [file.replace(fileURLToPath(ROOT), ''), file]))(
    '%s has no v-html or innerHTML',
    (_name, file) => {
      const source = readFileSync(file, 'utf8')
      expect(source).not.toMatch(/\bv-html\b/)
      expect(source).not.toMatch(/\.(inner|outer)HTML\s*=/)
      expect(source).not.toMatch(/insertAdjacentHTML|document\.write\(/)
    },
  )
})
