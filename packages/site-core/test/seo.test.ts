// The head of each template (M1.6, K-224): the title in WordPress' pattern, the canonical address and rel prev/next, Open Graph and
// Twitter, the sharing image's order of fallback, and JSON-LD that uses schema.org's types with their own properties only (checked
// here against the vocabulary's definitions, locally: no web service).
import type { ContentMediaRef, PublicContent, PublicSettings } from '@toascribe/shared'
import { describe, expect, it } from 'vitest'

import { jsonLdText, seoHead, sharingImage } from '../lib/seo'
import type { SeoInput } from '../lib/seo'

const ORIGIN = 'https://blogg.example'

const image = (id: string, url: string): ContentMediaRef => ({
  id,
  url,
  width: 1200,
  height: 630,
  alt: 'Fjellet',
  mime: 'image/webp',
  sizes: [],
})
const OWN = image('00000000-0000-4000-8000-000000000001', '/uploads/eget.webp')
const FEATURED = image('00000000-0000-4000-8000-000000000002', '/uploads/fremhevet.webp')
const DEFAULT = image('00000000-0000-4000-8000-000000000003', '/uploads/standard.webp')
const LOGO = image('00000000-0000-4000-8000-000000000004', '/uploads/logo.png')

const SETTINGS: PublicSettings = {
  title: 'Fjellbloggen',
  tagline: 'Turer og topper',
  locale: 'nb',
  timezone: 'Europe/Oslo',
  postsPerPage: 10,
  showOnFront: 'posts',
  postsPagePath: null,
  postsPageTitle: null,
  searchEngineVisible: true,
  privacyPolicyPath: null,
  embed: { clickToLoad: true, frameHosts: ['www.youtube-nocookie.com'] },
  maintenance: { enabled: false, message: '', retryAfter: 600 },
  securityTxt: { contact: '', policyUrl: '' },
  origin: ORIGIN,
  seo: { defaultImage: DEFAULT, publisher: { type: 'organization', name: 'Fjell AS', logo: LOGO } },
  cacheTags: [],
}

const POST: PublicContent = {
  id: '00000000-0000-4000-8000-0000000000a1',
  shortId: 12,
  type: 'post',
  title: 'Hei fjellet',
  slug: 'hei',
  path: '/hei/',

  publishedAt: '2026-10-26T08:30:00.000Z',
  modifiedAt: '2026-10-27T09:00:00.000Z',
  excerpt: 'Innledning om fjellet.',
  teaser: null,
  moreText: null,
  authors: [
    { id: '00000000-0000-4000-8000-0000000000b1', displayName: 'Kari', nicename: 'kari', path: '/author/kari/' },
  ],
  categories: [
    { id: '00000000-0000-4000-8000-0000000000c1', name: 'Lokalt', slug: 'lokalt', path: '/category/nyheter/lokalt/' },
  ],
  tags: [],
  featuredImage: FEATURED,
  sticky: false,
  protected: false,
  locked: false,
  blocks: [],
  media: [OWN, FEATURED],
  seo: { image: OWN.id },
  ancestors: [],
  template: null,
  parentId: null,
  commentStatus: 'open',
  page: 1,
  pages: 1,
}

const PAGE: PublicContent = {
  ...POST,
  id: '00000000-0000-4000-8000-0000000000a2',
  type: 'page',
  title: 'Teamet',
  slug: 'team',
  path: '/om/team/',

  categories: [],
  featuredImage: null,
  media: [],
  seo: {},
  ancestors: [{ title: 'Om oss', path: '/om/' }],
}

const LABELS: SeoInput['labels'] = {
  siteFallback: 'toascribe',
  date: (date) => `Arkiv: ${date}`,
  search: (query) => `Søk etter «${query}»`,
  notFound: 'Fant ikke siden',
  maintenance: 'Kort utilgjengelig for planlagt vedlikehold',
}

function input(overrides: Partial<SeoInput>): SeoInput {
  return {
    settings: SETTINGS,

    kind: 'home',
    content: undefined,
    archive: undefined,
    list: undefined,
    preview: false,
    labels: LABELS,
    ...overrides,
  }
}

const list = (page: number, pages: number) => ({ items: [], total: pages * 10, page, pages, perPage: 10 })
const prop = (head: ReturnType<typeof seoHead>, name: string) =>
  head.meta.find((tag) => tag.property === name || tag.name === name)?.content
const link = (head: ReturnType<typeof seoHead>, rel: string) => head.links.find((entry) => entry.rel === rel)?.href

/**
 * schema.org's types used here, each with the properties the vocabulary defines for it (its own and those it inherits from Thing,
 * CreativeWork and so on), as listed on schema.org/<Type>. Only what toascribe may write is listed; a property outside a type's set
 * is an error in the graph.
 */
const THING = [
  '@id',
  '@type',
  'name',
  'description',
  'url',
  'image',
  'sameAs',
  'potentialAction',
  'identifier',
  'mainEntityOfPage',
]
const CREATIVE_WORK = [
  ...THING,
  'headline',
  'author',
  'publisher',
  'datePublished',
  'dateModified',
  'inLanguage',
  'isPartOf',
  'about',
  'keywords',
]
const VOCABULARY: Record<string, { readonly allowed: readonly string[]; readonly required: readonly string[] }> = {
  WebSite: { allowed: CREATIVE_WORK, required: ['name', 'url'] },
  WebPage: { allowed: [...CREATIVE_WORK, 'breadcrumb', 'primaryImageOfPage'], required: ['name', 'url'] },
  BlogPosting: { allowed: [...CREATIVE_WORK, 'articleBody', 'wordCount'], required: ['headline', 'datePublished'] },
  BreadcrumbList: { allowed: [...THING, 'itemListElement', 'numberOfItems'], required: ['itemListElement'] },
  ListItem: { allowed: [...THING, 'item', 'position'], required: ['position', 'name', 'item'] },
  Organization: { allowed: [...THING, 'logo'], required: ['name', 'url'] },
  Person: { allowed: [...THING, 'jobTitle'], required: ['name'] },
  ImageObject: { allowed: [...CREATIVE_WORK, 'contentUrl', 'width', 'height', 'caption'], required: ['url'] },
  SearchAction: { allowed: [...THING, 'target', 'query-input'], required: ['target'] },
  EntryPoint: { allowed: [...THING, 'urlTemplate'], required: ['urlTemplate'] },
}

function expectSchemaOrg(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      expectSchemaOrg(entry, `${path}[${String(index)}]`)
    })
    return
  }
  if (typeof value !== 'object' || value === null) return
  const node = value as Record<string, unknown>
  const type = node['@type']
  if (typeof type === 'string') {
    const spec = VOCABULARY[type]
    expect(spec, `${path}: a schema.org type toascribe writes (${type})`).toBeDefined()
    for (const key of Object.keys(node)) expect(spec?.allowed, `${path}.${key} on ${type}`).toContain(key)
    for (const key of spec?.required ?? []) expect(node[key], `${path} ${type} needs ${key}`).toBeDefined()
  }
  for (const [key, child] of Object.entries(node)) if (key !== '@context') expectSchemaOrg(child, `${path}.${key}`)
}

const graph = (head: ReturnType<typeof seoHead>) => (head.jsonLd?.['@graph'] ?? []) as Record<string, unknown>[]
const types = (head: ReturnType<typeof seoHead>) => graph(head).map((node) => node['@type'])

describe('the head of each template', () => {
  it('front page of latest posts: «Nettsted – Slagord», canonical /, website, next page', () => {
    const head = seoHead(input({ kind: 'home', archive: { type: 'home' }, list: list(1, 3) }))
    expect(head.title).toBe('Fjellbloggen – Turer og topper')
    expect(link(head, 'canonical')).toBe(`${ORIGIN}/`)
    expect(link(head, 'prev')).toBeUndefined()
    expect(link(head, 'next')).toBe(`${ORIGIN}/page/2/`)
    expect(prop(head, 'og:type')).toBe('website')
    expect(prop(head, 'og:image')).toBe(`${ORIGIN}/uploads/standard.webp`)
    expect(types(head)).toEqual(['WebSite', 'Organization'])
    expectSchemaOrg(head.jsonLd)
  })

  it('a later page of the front page: canonical to itself, prev and next', () => {
    const head = seoHead(input({ kind: 'home', archive: { type: 'home' }, list: list(2, 3) }))
    expect(link(head, 'canonical')).toBe(`${ORIGIN}/page/2/`)
    expect(link(head, 'prev')).toBe(`${ORIGIN}/`)
    expect(link(head, 'next')).toBe(`${ORIGIN}/page/3/`)
  })

  it('a static front page: the front pattern, a WebPage', () => {
    const head = seoHead(input({ kind: 'front-page', content: { ...PAGE, path: '/', ancestors: [] } }))
    expect(head.title).toBe('Fjellbloggen – Turer og topper')
    expect(link(head, 'canonical')).toBe(`${ORIGIN}/`)
    expect(types(head)).toEqual(['WebSite', 'Organization', 'WebPage'])
    expectSchemaOrg(head.jsonLd)
  })

  it('a post: «Tittel – Nettsted», article cards, BlogPosting and breadcrumbs through its category', () => {
    const head = seoHead(input({ kind: 'single', content: POST }))
    expect(head.title).toBe('Hei fjellet – Fjellbloggen')
    expect(head.description).toBe('Innledning om fjellet.')
    expect(link(head, 'canonical')).toBe(`${ORIGIN}/hei/`)
    expect(prop(head, 'og:type')).toBe('article')
    expect(prop(head, 'og:url')).toBe(`${ORIGIN}/hei/`)
    expect(prop(head, 'og:image:width')).toBe('1200')
    expect(prop(head, 'article:published_time')).toBe(POST.publishedAt)
    expect(prop(head, 'twitter:card')).toBe('summary_large_image')
    expect(types(head)).toEqual(['WebSite', 'Organization', 'BlogPosting', 'BreadcrumbList'])
    const crumbs = graph(head)[3]?.['itemListElement'] as { name: string; item: string }[]
    expect(crumbs.map((crumb) => crumb.name)).toEqual(['Fjellbloggen', 'Lokalt', 'Hei fjellet'])
    expect(graph(head)[2]).toMatchObject({ author: { '@type': 'Person', name: 'Kari', url: `${ORIGIN}/author/kari/` } })
    expectSchemaOrg(head.jsonLd)
  })

  it("the SEO panel's title and description win", () => {
    const head = seoHead(
      input({ kind: 'single', content: { ...POST, seo: { title: 'Egen', description: 'Egen tekst' } } }),
    )
    expect(head.title).toBe('Egen – Fjellbloggen')
    expect(head.description).toBe('Egen tekst')
    expect(prop(head, 'og:title')).toBe('Egen')
  })

  it("a post's second page after a page break: canonical to it, prev and next", () => {
    const head = seoHead(input({ kind: 'single', content: { ...POST, page: 2, pages: 3 } }))
    expect(link(head, 'canonical')).toBe(`${ORIGIN}/hei/2/`)
    expect(link(head, 'prev')).toBe(`${ORIGIN}/hei/`)
    expect(link(head, 'next')).toBe(`${ORIGIN}/hei/3/`)
  })

  it('a page under a parent: WebPage and breadcrumbs through its parents', () => {
    const head = seoHead(input({ kind: 'page', content: PAGE }))
    expect(head.title).toBe('Teamet – Fjellbloggen')
    expect(prop(head, 'og:type')).toBe('website')
    expect(types(head)).toEqual(['WebSite', 'Organization', 'WebPage', 'BreadcrumbList'])
    const crumbs = graph(head)[3]?.['itemListElement'] as { name: string; item: string }[]
    expect(crumbs.map((crumb) => [crumb.name, crumb.item])).toEqual([
      ['Fjellbloggen', `${ORIGIN}/`],
      ['Om oss', `${ORIGIN}/om/`],
      ['Teamet', `${ORIGIN}/om/team/`],
    ])
    expectSchemaOrg(head.jsonLd)
  })

  it('a category, tag, author and date archive: their name, canonical, breadcrumbs', () => {
    const term = { id: POST.categories[0]?.id ?? '', name: 'Lokalt', slug: 'lokalt', path: '/category/nyheter/lokalt/' }
    const category = seoHead(
      input({
        kind: 'archive',
        archive: { type: 'category', term },
        list: list(2, 2),
      }),
    )
    expect(category.title).toBe('Lokalt – Fjellbloggen')
    expect(link(category, 'canonical')).toBe(`${ORIGIN}/category/nyheter/lokalt/page/2/`)
    expect(link(category, 'prev')).toBe(`${ORIGIN}/category/nyheter/lokalt/`)
    expect(link(category, 'next')).toBeUndefined()
    expect(types(category)).toContain('BreadcrumbList')
    expectSchemaOrg(category.jsonLd)
    const author = seoHead(
      input({
        kind: 'archive',
        archive: { type: 'author', author: POST.authors[0] ?? POST.authors[0]! },
        list: list(1, 1),
      }),
    )
    expect(author.title).toBe('Kari – Fjellbloggen')
    const date = seoHead(
      input({
        kind: 'archive',
        archive: { type: 'date', year: 2026, month: 10, day: null },
        list: list(1, 1),
      }),
    )
    expect(date.title).toBe('Arkiv: 2026-10 – Fjellbloggen')
    expect(link(date, 'canonical')).toBe(`${ORIGIN}/2026/10/`)
  })

  it('search, 404 and a preview: noindex, no canonical, no structured data', () => {
    for (const head of [
      seoHead(input({ kind: 'search', archive: { type: 'search', query: 'fjell' }, list: list(1, 1) })),
      seoHead(input({ kind: '404' })),
      seoHead(input({ kind: 'single', content: POST, preview: true })),
    ]) {
      expect(head.noindex).toBe(true)
      expect(link(head, 'canonical')).toBeUndefined()
      expect(head.jsonLd).toBeNull()
    }
    expect(seoHead(input({ kind: 'search', archive: { type: 'search', query: 'fjell' } })).title).toBe(
      'Søk etter «fjell» – Fjellbloggen',
    )
  })

  it('noindex from the SEO panel and from «Søkemotorsynlighet»', () => {
    expect(seoHead(input({ kind: 'single', content: { ...POST, seo: { noindex: true } } })).noindex).toBe(true)
    expect(seoHead(input({ settings: { ...SETTINGS, searchEngineVisible: false } })).noindex).toBe(true)
  })

  it('a person as the publisher', () => {
    const head = seoHead(
      input({
        settings: {
          ...SETTINGS,
          seo: { defaultImage: null, publisher: { type: 'person', name: 'Kari', path: '/author/kari/' } },
        },

        kind: 'single',
        content: POST,
      }),
    )
    expect(types(head)).toContain('Person')
    expect(graph(head)[2]).toMatchObject({ publisher: { '@id': `${ORIGIN}/#person` } })
    expectSchemaOrg(head.jsonLd)
  })
})

describe('addresses built from what the api resolved', () => {
  it("a split post under «Enkel»: its pages are `/?p=12&page=2`, not another post's address", () => {
    const head = seoHead(input({ kind: 'single', content: { ...POST, path: '/?p=12', page: 2, pages: 3 } }))
    expect(link(head, 'canonical')).toBe(`${ORIGIN}/?p=12&page=2`)
    expect(link(head, 'prev')).toBe(`${ORIGIN}/?p=12`)
    expect(link(head, 'next')).toBe(`${ORIGIN}/?p=12&page=3`)
  })

  it('a split post under a structure without the closing slash: `/hei/2/`', () => {
    const head = seoHead(input({ kind: 'single', content: { ...POST, path: '/hei', page: 2, pages: 2 } }))
    expect(link(head, 'canonical')).toBe(`${ORIGIN}/hei/2/`)
    expect(link(head, 'prev')).toBe(`${ORIGIN}/hei/`)
  })

  it("an archive's canonical is its own address, whatever the request looked like", () => {
    const author = { id: POST.authors[0]?.id ?? '', displayName: 'Kari', nicename: 'kari', path: '/author/kari/' }
    const head = seoHead(input({ kind: 'archive', archive: { type: 'author', author }, list: list(2, 3) }))
    expect(link(head, 'canonical')).toBe(`${ORIGIN}/author/kari/page/2/`)
    expect(link(head, 'prev')).toBe(`${ORIGIN}/author/kari/`)
    expect(link(head, 'next')).toBe(`${ORIGIN}/author/kari/page/3/`)
  })

  it('the page of posts under a static front page: its own title, address and breadcrumbs', () => {
    const settings = { ...SETTINGS, showOnFront: 'page' as const, postsPagePath: '/blogg/', postsPageTitle: 'Blogg' }
    const head = seoHead(input({ settings, kind: 'home', archive: { type: 'home' }, list: list(1, 2) }))
    expect(head.title).toBe('Blogg – Fjellbloggen')
    expect(link(head, 'canonical')).toBe(`${ORIGIN}/blogg/`)
    expect(link(head, 'next')).toBe(`${ORIGIN}/blogg/page/2/`)
    expect(types(head)).toContain('BreadcrumbList')
  })

  it("the SEO panel's title wins on a static front page too", () => {
    const front = { ...PAGE, path: '/', ancestors: [], seo: { title: 'Velkommen til fjellet' } }
    expect(seoHead(input({ kind: 'front-page', content: front })).title).toBe('Velkommen til fjellet – Fjellbloggen')
  })
})

describe('the sharing image', () => {
  it("is the item's own, then its featured image, then the site's default, then none", () => {
    expect(sharingImage(POST, SETTINGS)?.id).toBe(OWN.id)
    expect(sharingImage({ ...POST, seo: {} }, SETTINGS)?.id).toBe(FEATURED.id)
    expect(sharingImage({ ...POST, seo: {}, featuredImage: null }, SETTINGS)?.id).toBe(DEFAULT.id)
    expect(
      sharingImage(
        { ...POST, seo: {}, featuredImage: null },
        { ...SETTINGS, seo: { ...SETTINGS.seo, defaultImage: null } },
      ),
    ).toBeNull()
    const none = seoHead(
      input({
        settings: { ...SETTINGS, seo: { ...SETTINGS.seo, defaultImage: null } },
        kind: 'single',

        content: { ...POST, seo: {}, featuredImage: null },
      }),
    )
    expect(prop(none, 'twitter:card')).toBe('summary')
    expect(prop(none, 'og:image')).toBeUndefined()
  })
})

describe('jsonLdText', () => {
  it('cannot end its script element', () => {
    const text = jsonLdText({ name: '</script><script>alert(1)</script> & co' })
    expect(text).not.toContain('<')
    expect(text).not.toContain('>')
    expect(JSON.parse(text)).toEqual({ name: '</script><script>alert(1)</script> & co' })
  })
})

describe('security.txt (M1.8, K-319)', () => {
  it('names the contact, the policy, the languages and the canonical address, and expires within a year', async () => {
    const { securityTxt } = await import('../lib/feeds.ts')
    const now = new Date('2026-10-28T12:00:00Z')
    const text = securityTxt(
      {
        securityTxt: { contact: 'mailto:sikkerhet@blogg.example', policyUrl: 'https://blogg.example/sikkerhet' },
        origin: 'https://blogg.example',
        locale: 'nb',
      },
      now,
    )
    expect(text).toBe(
      [
        'Contact: mailto:sikkerhet@blogg.example',
        'Expires: 2027-04-28T00:00:00Z',
        'Policy: https://blogg.example/sikkerhet',
        'Preferred-Languages: no, en',
        'Canonical: https://blogg.example/.well-known/security.txt',
        '',
      ].join('\n'),
    )
    expect(
      securityTxt({ securityTxt: { contact: '', policyUrl: '' }, origin: 'https://blogg.example' }, now),
    ).toBeUndefined()
  })

  it('writes no file for a value with a line break or a control character, so no line can be slipped in', async () => {
    const { securityTxt } = await import('../lib/feeds.ts')
    const now = new Date('2026-10-28T12:00:00Z')
    for (const [contact, policyUrl] of [
      ['mailto:a@b.example', 'https://b.example/x\nContact: mailto:evil@x.example'],
      ['mailto:a@b.example\r\nPolicy: https://evil.example', ''],
      ['mailto:a@b.example', 'https://b.example/\u2028x'],
      ['mailto:a\u0000@b.example', ''],
    ] as const) {
      expect(securityTxt({ securityTxt: { contact, policyUrl }, origin: 'https://b.example' }, now)).toBeUndefined()
    }
  })
})
