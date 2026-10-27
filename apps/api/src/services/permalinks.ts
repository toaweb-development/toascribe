// The addresses of the site (M1.5, K-197, K-221): a post's after «Innstillinger → Permalenker», a category's with its parents after the
// category base, a tag's after the tag base, an author's. Read once per request from the settings; every address the api gives is
// built here, so a change of structure changes them all (menus and lists included), and resolve reads them back with the same rules.
import type { Database } from '@toascribe/db'
import {
  CoreSettings,
  DEFAULT_CATEGORY_BASE,
  DEFAULT_PERMALINK_STRUCTURE,
  DEFAULT_TAG_BASE,
  cleanBase,
  dateParts,
  postPath,
  structureProblem,
} from '@toascribe/shared'

import type { Executor } from '../repositories/executor.ts'
import { categoryChains, firstCategoryOf, publicAuthorsOf } from '../repositories/public.ts'
import { readSettings } from '../repositories/settings.ts'

export const LINK_SETTINGS = CoreSettings.pick({
  permalink_structure: true,
  category_base: true,
  tag_base: true,
  permalink_history: true,
  timezone_string: true,
  gmt_offset: true,
})

/** One set of address rules: the structure and the two bases. */
export interface LinkRules {
  readonly structure: string
  readonly categoryBase: string
  readonly tagBase: string
}

/** What a post's address needs from its row. A draft has no publish time; its address uses the last change. */
export interface LinkedPost {
  readonly id: string
  readonly shortId: number
  readonly slug: string
  readonly publishedAt: Date | null
  readonly modifiedAt: Date
}

export interface Links extends LinkRules {
  readonly timeZone: string
  /** The rules the site had before, newest first (a change of structure keeps old addresses working, K-207). */
  readonly history: readonly LinkRules[]
  /** The address of each post, under these rules or under older ones. */
  postPaths(posts: readonly LinkedPost[], rules?: LinkRules): Promise<Map<string, string>>
  /** The address of each category: the base, then its parents' slugs and its own. */
  categoryPaths(ids: readonly string[], rules?: LinkRules): Promise<Map<string, string>>
  tagPath(slug: string, rules?: LinkRules): string
  authorPath(nicename: string): string
}

/** The time zone as Intl and PostgreSQL take it: an IANA name, or the offset of WordPress' «UTC+1». */
export function siteTimeZone(settings: { readonly timezone_string: string; readonly gmt_offset: number }): string {
  if (settings.timezone_string !== '') return settings.timezone_string
  const minutes = Math.round(Math.abs(settings.gmt_offset) * 60)
  const sign = settings.gmt_offset < 0 ? '-' : '+'
  return `${sign}${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

const encodeBase = (base: string) => base.split('/').map(encodeURIComponent).join('/')

/** The rules as stored, cleaned: a structure that does not pass falls back to the default (it was checked when it was saved). */
export function rulesOf(stored: { structure: string; category_base: string; tag_base: string }): LinkRules {
  return {
    structure: structureProblem(stored.structure) === undefined ? stored.structure : DEFAULT_PERMALINK_STRUCTURE,
    categoryBase: cleanBase(stored.category_base, DEFAULT_CATEGORY_BASE),
    tagBase: cleanBase(stored.tag_base, DEFAULT_TAG_BASE),
  }
}

export async function loadLinks(db: Database | Executor, onInvalidSetting?: (key: string) => void): Promise<Links> {
  const settings = await readSettings(db, LINK_SETTINGS, onInvalidSetting)
  const current = rulesOf({
    structure: settings.permalink_structure,
    category_base: settings.category_base,
    tag_base: settings.tag_base,
  })
  const timeZone = siteTimeZone(settings)
  return {
    ...current,
    timeZone,
    history: settings.permalink_history.map(rulesOf),

    async postPaths(posts, rules = current) {
      const ids = posts.map((post) => post.id)
      const needsCategory = rules.structure.includes('%category%')
      const needsAuthor = rules.structure.includes('%author%')
      const [firstCategory, authors] = await Promise.all([
        needsCategory ? firstCategoryOf(db, ids) : Promise.resolve(new Map<string, string>()),
        needsAuthor ? publicAuthorsOf(db, ids) : Promise.resolve(new Map<string, { nicename: string }[]>()),
      ])
      const chains = needsCategory ? await categoryChains(db, [...firstCategory.values()]) : new Map<string, string>()
      return new Map(
        posts.map((post) => {
          const categoryId = firstCategory.get(post.id)
          return [
            post.id,
            postPath(rules.structure, {
              shortId: post.shortId,
              slug: post.slug,
              ...dateParts(post.publishedAt ?? post.modifiedAt, timeZone),
              // WordPress' fallback for a post without a category: «uncategorized»'s slug; toascribe always has the default one.
              category: (categoryId === undefined ? undefined : chains.get(categoryId)) ?? 'ukategorisert',
              author: authors.get(post.id)?.[0]?.nicename ?? 'admin',
            }),
          ]
        }),
      )
    },

    async categoryPaths(ids, rules = current) {
      const chains = await categoryChains(db, ids)
      return new Map(
        [...chains].map(([id, chain]) => [
          id,
          `/${encodeBase(rules.categoryBase)}/${chain.split('/').map(encodeURIComponent).join('/')}/`,
        ]),
      )
    },

    tagPath: (slug, rules = current) => `/${encodeBase(rules.tagBase)}/${encodeURIComponent(slug)}/`,
    authorPath: (nicename) => `/author/${encodeURIComponent(nicename)}/`,
  }
}
