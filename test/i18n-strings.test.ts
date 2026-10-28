// Screen text goes through i18n from the start: every user-facing string is a message in an i18n/locales/nb.json file,
// with an English key, and a template or a page head only calls t('…'). The Nuxt build does not notice a hard-coded
// string or a key that no message file has, so this test reads the sources.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = new URL('../', import.meta.url)

/** Where Nuxt code lives: the shared layer, the two apps and the theme layer. */
const NUXT_DIRS = ['packages/nuxt-base', 'packages/site-core', 'apps/site', 'apps/admin', 'themes/default']

function path(relative: string): string {
  return fileURLToPath(new URL(relative, ROOT))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Every file under `relative` with one of the extensions, skipping build output and dependencies. */
function files(relative: string, extensions: readonly string[]): string[] {
  const start = path(relative)
  if (!existsSync(start)) return []
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (['node_modules', '.nuxt', '.output', 'dist'].includes(entry)) continue
      const full = `${dir}/${entry}`
      if (statSync(full).isDirectory()) walk(full)
      else if (extensions.some((extension) => entry.endsWith(extension))) found.push(full)
    }
  }
  walk(start)
  return found
}

/** The dotted keys of a message file, with their values. A message is a string; a group is an object. */
function flatten(value: unknown, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>()
  if (!isRecord(value)) return out
  for (const [key, child] of Object.entries(value)) {
    const full = prefix === '' ? key : `${prefix}.${key}`
    if (isRecord(child)) {
      for (const [nested, leaf] of flatten(child, full)) out.set(nested, leaf)
    } else {
      out.set(full, child)
    }
  }
  return out
}

const messageFiles = NUXT_DIRS.map((dir) => `${dir}/i18n/locales/nb.json`).filter((file) => existsSync(path(file)))

const messagesByFile = new Map(
  messageFiles.map((file) => [file, flatten(JSON.parse(readFileSync(path(file), 'utf8')) as unknown)]),
)

describe('the message files', () => {
  it('exist for the shared layer, the site core, the theme and the admin (the site has only what they bring)', () => {
    expect(messageFiles).toEqual(
      expect.arrayContaining([
        'packages/nuxt-base/i18n/locales/nb.json',
        'packages/site-core/i18n/locales/nb.json',
        'themes/default/i18n/locales/nb.json',
        'apps/admin/i18n/locales/nb.json',
      ]),
    )
  })

  it.each(messageFiles)('%s holds English keys and non-empty string messages', (file) => {
    for (const [key, message] of messagesByFile.get(file) ?? []) {
      expect(key, `${file}: key`).toMatch(/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$/)
      expect(typeof message === 'string' && message.trim() !== '', `${file}: ${key}`).toBe(true)
    }
  })

  it.each(messageFiles)('%s holds messages vue-i18n compiles: `@` and braces only as it reads them', (file) => {
    // vue-i18n reads `@` as a linked message and `{…}` as a placeholder or a literal; a stray one fails the page at render (500).
    for (const [key, message] of messagesByFile.get(file) ?? []) {
      const text = typeof message === 'string' ? message : ''
      const outside = text.replace(/\{'[^']*'\}/g, '').replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, '')
      expect(outside, `${file}: ${key} (escape as {'@'}, {'{'})`).not.toMatch(/[@{}]/)
    }
  })

  it('share no key between files, because Nuxt merges them into one catalogue', () => {
    const seen = new Map<string, string>()
    for (const [file, messages] of messagesByFile) {
      for (const key of messages.keys()) {
        expect(seen.get(key), `${key} is in ${seen.get(key) ?? ''} and in ${file}`).toBeUndefined()
        seen.set(key, file)
      }
    }
  })
})

/**
 * The English admin (M1.8, K-330): the admin and the shared layer have an en.json beside nb.json with every key of it, the same
 * placeholders and the same number of plural forms, so no screen falls back to bokmål or shows a key. The site's layers are bokmål
 * only in phase 1.
 */
const ENGLISH_DIRS = ['packages/nuxt-base', 'apps/admin']

describe('the English messages', () => {
  const placeholders = (text: string) => [...text.matchAll(/\{[A-Za-z_][A-Za-z0-9_]*\}/g)].map((m) => m[0]).sort()
  const forms = (text: string) => text.split(' | ').length

  it.each(ENGLISH_DIRS)('%s has an en.json with every key of nb.json and nothing else', (dir) => {
    const english = `${dir}/i18n/locales/en.json`
    expect(existsSync(path(english)), english).toBe(true)
    const nb = messagesByFile.get(`${dir}/i18n/locales/nb.json`) ?? new Map<string, unknown>()
    const en = flatten(JSON.parse(readFileSync(path(english), 'utf8')) as unknown)
    expect(
      [...en.keys()].filter((key) => !nb.has(key)),
      `${english}: keys nb.json does not have`,
    ).toEqual([])
    expect(
      [...nb.keys()].filter((key) => !en.has(key)),
      `${english}: keys it is missing`,
    ).toEqual([])
    for (const [key, message] of en) {
      const text = typeof message === 'string' ? message : ''
      const known = nb.get(key)
      const norsk = typeof known === 'string' ? known : ''
      expect(text.trim(), `${english}: ${key} is empty`).not.toBe('')
      expect(placeholders(text), `${english}: ${key} placeholders`).toEqual(placeholders(norsk))
      expect(forms(text), `${english}: ${key} plural forms`).toBe(forms(norsk))
      const outside = text.replace(/\{'[^']*'\}/g, '').replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, '')
      expect(outside, `${english}: ${key} (escape as {'@'}, {'{'})`).not.toMatch(/[@{}]/)
    }
  })
})

/** The keys that code asks for with t('…'), $t('…') or the <i18n-t keypath="…"> component. */
function usedKeys(): Map<string, string> {
  const used = new Map<string, string>()
  const call = /(?:\$t|\bt)\(\s*'([^']+)'/g
  const keypath = /keypath="([^"]+)"/g
  for (const dir of NUXT_DIRS) {
    for (const file of files(dir, ['.vue', '.ts'])) {
      if (file.includes('/test/') || file.endsWith('nuxt.config.ts') || file.endsWith('.config.ts')) continue
      const source = readFileSync(file, 'utf8')
      for (const pattern of [call, keypath]) {
        for (const match of source.matchAll(pattern)) {
          const key = match[1]
          if (key !== undefined) used.set(key, file.replace(path(''), ''))
        }
      }
    }
  }
  return used
}

describe('the keys in use', () => {
  const catalogue = new Set([...messagesByFile.values()].flatMap((messages) => [...messages.keys()]))
  const used = usedKeys()

  it('finds the keys that the code asks for', () => {
    expect(used.size).toBeGreaterThan(5)
  })

  it('all have a message', () => {
    for (const [key, file] of used) {
      expect(catalogue.has(key), `${file} asks for ${key}, which no nb.json has`).toBe(true)
    }
  })

  it('are all the messages there are, so none is left behind', () => {
    for (const key of catalogue) {
      expect(used.has(key), `${key} is in a message file and nothing asks for it`).toBe(true)
    }
  })
})

/** The attributes of a component or element that carry text a person reads. */
const TEXT_ATTRIBUTES = [
  'title',
  'label',
  'description',
  'placeholder',
  'alt',
  'aria-label',
  'lead',
  'text',
  'heading',
  'content',
  'tooltip',
]

const HEAD_FIELDS = ['title', 'description', 'ogTitle', 'ogDescription', 'ogSiteName', 'twitterTitle']

function templateOf(source: string): string {
  const start = source.indexOf('<template>')
  const end = source.lastIndexOf('</template>')
  return start === -1 || end === -1 ? '' : source.slice(start + '<template>'.length, end)
}

function scriptOf(source: string): string {
  return /<script[^>]*>([\s\S]*?)<\/script>/.exec(source)?.[1] ?? ''
}

describe('hard-coded strings', () => {
  const vueFiles = NUXT_DIRS.flatMap((dir) => files(dir, ['.vue']))

  it('finds the components and pages', () => {
    expect(vueFiles.length).toBeGreaterThanOrEqual(6)
  })

  it.each(vueFiles.map((file) => file.replace(path(''), '')))('%s has none in its template', (relative) => {
    const template = templateOf(readFileSync(path(relative), 'utf8'))
    // Text between tags, once the {{ }} expressions and the tags themselves are taken out.
    const withoutExpressions = template.replace(/\{\{[\s\S]*?\}\}/g, '')
    const text = [...withoutExpressions.matchAll(/>([^<>]*)</g)]
      .map((match) => (match[1] ?? '').trim())
      .filter((chunk) => /\p{L}/u.test(chunk))
    expect(text, `${relative}: text between tags`).toEqual([])

    // Static attributes (title="…", not :title="…") that hold readable text.
    const attributes = TEXT_ATTRIBUTES.flatMap((name) =>
      [...template.matchAll(new RegExp(`(?<![:\\w-])${name}="([^"]*)"`, 'g'))]
        .map((match) => `${name}="${match[1] ?? ''}"`)
        .filter((found) => /\p{L}/u.test(found.slice(name.length + 2))),
    )
    expect(attributes, `${relative}: static text attributes`).toEqual([])
  })

  it.each(vueFiles.map((file) => file.replace(path(''), '')))('%s sets its page head from messages', (relative) => {
    const script = scriptOf(readFileSync(path(relative), 'utf8'))
    for (const field of HEAD_FIELDS) {
      // `title: 'text'` or a template literal; `title: t('key')` and `title,` are fine.
      expect(script, `${relative}: ${field}`).not.toMatch(new RegExp(`\\b${field}\\s*:\\s*['"\`]`))
    }
    // A const that is later used as a head field must not be a literal either.
    expect(script, `${relative}: const title/description`).not.toMatch(/\bconst\s+(title|description)\s*=\s*['"`]/)
  })
})
