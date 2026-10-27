// The theme of the site, read at build time (M1.4; PLAN «Temaspesifikasjon og installasjon»). A theme is a Nuxt layer with a
// `theme.json`; a child theme is a layer that extends its parent's. Nuxt hands the module the layers in priority order (the app
// first, then what it extends, nearest first), so the child comes before its parent, and the first file of a name wins.
//
// What is read from each layer, under its source folder (`app/` in a Nuxt 4 layer) and its root (PLAN's layout):
// - `theme.json`, checked against ThemeManifest; a broken one stops the build with every error;
// - `templates/<name>.vue`: the templates of WordPress' hierarchy (`index`, `single`, `page`, `archive`, `category`, `404`, …) and the
//   page templates the manifest offers; `index` is required of the theme;
// - `blocks/<name>/View.vue`: the theme's own view of a block (`blocks/quote/View.vue` for `core/quote`, `blocks/acme.slider/View.vue`
//   for `acme/slider`).
//
// Plain Node, no Nuxt: the module (modules/theme.ts) calls it, and the tests call it on fixture folders.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// The shared package is read from its source: this runs in Node while Nuxt loads its config, before anything is built.
import { DEFAULT_HEADING_LEVELS, ThemeManifest } from '../../shared/src/theme.ts'
import type { ActiveTheme, ThemeTemplate } from '../../shared/src/theme.ts'

/** A layer as Nuxt describes it. */
export interface LayerDirs {
  readonly rootDir: string
  readonly srcDir: string
}

export interface ThemeLayer extends LayerDirs {
  readonly manifest: ThemeManifest
}

export interface ResolvedTheme {
  /** The active theme for the admin; null when no layer is a theme (the core layer on its own). */
  readonly active: ActiveTheme | null
  /** Template name → its file, the first layer's file of a name. */
  readonly templates: ReadonlyMap<string, string>
  /** Block type → the file of the theme's own view. */
  readonly blockViews: ReadonlyMap<string, string>
}

/** Everything that is wrong with the themes, one line each. */
export class ThemeError extends Error {
  readonly problems: readonly string[]
  constructor(problems: readonly string[]) {
    super(`The theme cannot be used:\n- ${problems.join('\n- ')}`)
    this.name = 'ThemeError'
    this.problems = problems
  }
}

const TEMPLATE_NAME = /^[a-z0-9][a-z0-9_.-]*$/
const BLOCK_FOLDER = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)?$/

/** The folders of a layer to look in: its source folder, and its root when that is another folder. */
function foldersOf(layer: LayerDirs): string[] {
  return [...new Set([layer.srcDir, layer.rootDir])]
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory()
}

/** The layers that are themes, in priority order, with their manifests; ThemeError when one is broken or the chain is wrong. */
export function readThemeLayers(layers: readonly LayerDirs[]): ThemeLayer[] {
  const problems: string[] = []
  const themes: ThemeLayer[] = []
  for (const layer of layers) {
    const file = join(layer.rootDir, 'theme.json')
    if (!existsSync(file)) continue
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      problems.push(`${file}: not JSON (${error instanceof Error ? error.message : String(error)})`)
      continue
    }
    const parsed = ThemeManifest.safeParse(raw)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        problems.push(`${file}: ${issue.path.length === 0 ? '(root)' : issue.path.join('.')}: ${issue.message}`)
      }
      continue
    }
    themes.push({ ...layer, manifest: parsed.data })
  }
  // The chain: each theme names the next as its parent, and the last names none.
  themes.forEach((theme, index) => {
    const next = themes[index + 1]
    const parent = theme.manifest.parent
    if (next === undefined && parent !== undefined) {
      problems.push(`${theme.manifest.slug}: its parent theme «${parent}» is not a layer it extends`)
    } else if (next !== undefined && parent !== next.manifest.slug) {
      problems.push(
        `${theme.manifest.slug}: extends the theme «${next.manifest.slug}» but names ${parent === undefined ? 'no parent' : `«${parent}»`} in theme.json`,
      )
    }
  })
  if (problems.length > 0) throw new ThemeError(problems)
  return themes
}

/** The files of a folder that match, by name (without the extension). */
function filesIn(folder: string, pick: (entry: string) => string | undefined): Map<string, string> {
  const found = new Map<string, string>()
  if (!isDirectory(folder)) return found
  for (const entry of readdirSync(folder).sort()) {
    const name = pick(entry)
    if (name !== undefined) found.set(name, join(folder, entry))
  }
  return found
}

/** The block type a `blocks/<folder>/` is for: `quote` → `core/quote`, `acme.slider` → `acme/slider`. */
export function blockTypeOf(folder: string): string | undefined {
  if (!BLOCK_FOLDER.test(folder)) return undefined
  const [namespace, name] = folder.includes('.') ? folder.split('.') : ['core', folder]
  return `${namespace ?? 'core'}/${name ?? ''}`
}

/** The theme of the site from Nuxt's layers: its templates, its block views and what the admin reads. */
export function resolveTheme(layers: readonly LayerDirs[]): ResolvedTheme {
  const themes = readThemeLayers(layers)
  const templates = new Map<string, string>()
  const blockViews = new Map<string, string>()
  // Lowest priority first, so a nearer layer's file replaces a farther one's.
  for (const layer of [...layers].reverse()) {
    for (const folder of foldersOf(layer)) {
      for (const [name, file] of filesIn(join(folder, 'templates'), (entry) => {
        const name = entry.endsWith('.vue') ? entry.slice(0, -4) : undefined
        return name !== undefined && TEMPLATE_NAME.test(name) ? name : undefined
      })) {
        templates.set(name, file)
      }
      const blocks = join(folder, 'blocks')
      if (!isDirectory(blocks)) continue
      for (const entry of readdirSync(blocks).sort()) {
        const type = blockTypeOf(entry)
        const view = join(blocks, entry, 'View.vue')
        if (type !== undefined && existsSync(view)) blockViews.set(type, view)
      }
    }
  }
  const [active] = themes
  if (active === undefined) return { active: null, templates, blockViews }

  const problems: string[] = []
  if (!templates.has('index'))
    problems.push(`${active.manifest.slug}: templates/index.vue is required (the last fallback)`)
  // Parent first, so the child's entry of a slug wins.
  const offered = new Map<string, ThemeTemplate>()
  for (const theme of [...themes].reverse()) {
    for (const template of theme.manifest.templates ?? []) offered.set(template.slug, template)
  }
  for (const template of offered.values()) {
    if (!templates.has(template.slug)) {
      problems.push(
        `${active.manifest.slug}: the page template «${template.slug}» has no templates/${template.slug}.vue`,
      )
    }
  }
  if (problems.length > 0) throw new ThemeError(problems)

  const first = <T>(pick: (manifest: ThemeManifest) => T | undefined): T | undefined =>
    themes.map((theme) => pick(theme.manifest)).find((value) => value !== undefined)
  const merged = (pick: (manifest: ThemeManifest) => Record<string, string> | undefined): Record<string, string> =>
    Object.assign({}, ...[...themes].reverse().map((theme) => pick(theme.manifest) ?? {})) as Record<string, string>
  return {
    active: {
      slug: active.manifest.slug,
      name: active.manifest.name,
      version: active.manifest.version,
      parents: themes.slice(1).map((theme) => theme.manifest.slug),
      headingLevels: [...(first((manifest) => manifest.supports?.headingLevels) ?? DEFAULT_HEADING_LEVELS)].sort(),
      templates: [...offered.values()],
      menus: merged((manifest) => manifest.menus),
      areas: merged((manifest) => manifest.areas),
    },
    templates,
    blockViews,
  }
}
