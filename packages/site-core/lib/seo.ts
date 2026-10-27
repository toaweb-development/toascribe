// What a page of the site says about itself to search engines and to sharing (M1.6, K-224): the title in WordPress' pattern, the
// description, the canonical address, rel prev/next on a page of a list or of a split post, Open Graph and Twitter cards, and
// JSON-LD (WebSite, BlogPosting or WebPage, BreadcrumbList, the publisher). A pure function of what the page resolved and the
// site's settings, so each template's head can be tested without a browser; ScribeHead writes the result. Every address is
// absolute on the site's origin (PUBLIC_ORIGIN, from the api), never on the request's Host.
import type { ContentMediaRef, PublicArchive, PublicContent, PublicList, PublicSettings } from '@toascribe/shared'

export interface SeoInput {
  readonly settings: PublicSettings
  /** The address of the page (the route's path, `/page/2/` included). */
  readonly path: string
  readonly kind: string
  readonly content: PublicContent | undefined
  readonly archive: PublicArchive | undefined
  readonly list: PublicList | undefined
  readonly preview: boolean
  /** Translated texts the page title needs. */
  readonly labels: {
    /** The site's name when it has none (the product's). */
    readonly siteFallback: string
    readonly date: (date: string) => string
    readonly search: (query: string) => string
    readonly notFound: string
  }
}

export interface SeoHead {
  readonly title: string
  readonly description: string | undefined
  readonly noindex: boolean
  readonly meta: readonly { readonly name?: string; readonly property?: string; readonly content: string }[]
  readonly links: readonly { readonly rel: 'canonical' | 'prev' | 'next'; readonly href: string }[]
  /** The JSON-LD graph, or null where a page has none (404, search, preview). */
  readonly jsonLd: Record<string, unknown> | null
}

/** WordPress' title separator (Tor's decision, M1.6: «Tittel – Nettstedstittel»). */
const SEPARATOR = ' – '

function absolute(origin: string, url: string): string {
  return /^https?:\/\//.test(url) ? url : `${origin}${url.startsWith('/') ? url : `/${url}`}`
}

/** `/category/x/page/3/` → `/category/x/`: the first page of a list. */
function listBase(path: string): string {
  return path.replace(/page\/\d+\/$/, '')
}

function pageOf(base: string, page: number): string {
  return page <= 1 ? base : `${base}page/${String(page)}/`
}

/** The sharing image (Tor's order): the item's own, its featured image, the site's default. */
export function sharingImage(content: PublicContent | undefined, settings: PublicSettings): ContentMediaRef | null {
  const own = content?.seo.image === undefined ? undefined : content.media.find((ref) => ref.id === content.seo.image)
  return own ?? content?.featuredImage ?? settings.seo.defaultImage ?? null
}

/** JSON in a `<script>`: `<`, `>` and `&` as escapes, so nothing in a title can end the element. */
export function jsonLdText(graph: Record<string, unknown>): string {
  return JSON.stringify(graph).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
}

export function seoHead(input: SeoInput): SeoHead {
  const { settings, content, archive, list } = input
  const origin = settings.origin.replace(/\/+$/, '')
  const site = settings.title || input.labels.siteFallback
  const isFront = input.kind === 'front-page' || (input.kind === 'home' && listBase(input.path) === '/')

  // The title: «Tittel – Nettstedstittel», and on the front page «Nettstedstittel – Slagord».
  let own = ''
  if (content !== undefined) own = content.seo.title || content.title
  else if (archive?.type === 'category' || archive?.type === 'tag') own = archive.term.name
  else if (archive?.type === 'author') own = archive.author.displayName
  else if (archive?.type === 'date')
    own = input.labels.date([archive.year, archive.month, archive.day].filter((part) => part !== null).join('-'))
  else if (archive?.type === 'search') own = input.labels.search(archive.query)
  else if (input.kind === '404') own = input.labels.notFound
  const title = isFront
    ? [site, settings.tagline].filter((part) => part !== '').join(SEPARATOR)
    : [own, site].filter((part) => part !== '').join(SEPARATOR)

  const description =
    (content === undefined ? undefined : content.seo.description || content.excerpt) || settings.tagline || undefined
  const noindex =
    !settings.searchEngineVisible ||
    input.preview ||
    input.kind === '404' ||
    input.kind === 'search' ||
    content?.seo.noindex === true

  // The canonical address: the item (its page of a split post), or the list's page. None for a search, a 404 or a preview.
  const indexable = !input.preview && input.kind !== '404' && input.kind !== 'search' && input.kind !== 'redirect'
  let canonical: string | undefined
  const links: { rel: 'canonical' | 'prev' | 'next'; href: string }[] = []
  if (indexable && content !== undefined) {
    const base = input.kind === 'front-page' ? '/' : content.path
    const at = (page: number) => (page <= 1 ? base : `${base}${String(page)}/`)
    canonical = absolute(origin, at(content.page))
    if (content.page > 1) links.push({ rel: 'prev', href: absolute(origin, at(content.page - 1)) })
    if (content.page < content.pages) links.push({ rel: 'next', href: absolute(origin, at(content.page + 1)) })
  } else if (indexable && list !== undefined) {
    const base = listBase(input.path)
    canonical = absolute(origin, pageOf(base, list.page))
    if (list.page > 1) links.push({ rel: 'prev', href: absolute(origin, pageOf(base, list.page - 1)) })
    if (list.page < list.pages) links.push({ rel: 'next', href: absolute(origin, pageOf(base, list.page + 1)) })
  }
  if (canonical !== undefined) links.unshift({ rel: 'canonical', href: canonical })

  // Open Graph and Twitter.
  const image = sharingImage(content, settings)
  const shareTitle = isFront ? site : own || site
  const isArticle = content?.type === 'post'
  const meta: { name?: string; property?: string; content: string }[] = [
    { property: 'og:type', content: isArticle ? 'article' : 'website' },
    { property: 'og:title', content: shareTitle },
    { property: 'og:site_name', content: site },
    { property: 'og:locale', content: settings.locale.replace('-', '_') },
    ...(canonical === undefined ? [] : [{ property: 'og:url', content: canonical }]),
    ...(description === undefined ? [] : [{ property: 'og:description', content: description }]),
    ...(image === null
      ? []
      : [
          { property: 'og:image', content: absolute(origin, image.url) },
          ...(image.width === null ? [] : [{ property: 'og:image:width', content: String(image.width) }]),
          ...(image.height === null ? [] : [{ property: 'og:image:height', content: String(image.height) }]),
          ...(image.alt === '' ? [] : [{ property: 'og:image:alt', content: image.alt }]),
        ]),
    ...(isArticle && content !== undefined
      ? [
          { property: 'article:published_time', content: content.publishedAt },
          { property: 'article:modified_time', content: content.modifiedAt },
        ]
      : []),
    { name: 'twitter:card', content: image === null ? 'summary' : 'summary_large_image' },
    { name: 'twitter:title', content: shareTitle },
    ...(description === undefined ? [] : [{ name: 'twitter:description', content: description }]),
    ...(image === null ? [] : [{ name: 'twitter:image', content: absolute(origin, image.url) }]),
  ]

  return {
    title,
    description,
    noindex,
    meta,
    links,
    jsonLd: indexable ? graphOf({ input, origin, site, own, canonical, description, image, isFront }) : null,
  }
}

function graphOf(context: {
  input: SeoInput
  origin: string
  site: string
  own: string
  canonical: string | undefined
  description: string | undefined
  image: ContentMediaRef | null
  isFront: boolean
}): Record<string, unknown> {
  const { input, origin, site, canonical, description, image } = context
  const { settings, content, archive } = input
  const websiteId = `${origin}/#website`
  const publisher = settings.seo.publisher
  const publisherId = publisher === null ? undefined : `${origin}/#${publisher.type}`
  const imageObject = (ref: ContentMediaRef) => ({
    '@type': 'ImageObject',
    url: absolute(origin, ref.url),
    ...(ref.width === null ? {} : { width: ref.width }),
    ...(ref.height === null ? {} : { height: ref.height }),
  })
  const nodes: Record<string, unknown>[] = [
    {
      '@type': 'WebSite',
      '@id': websiteId,
      url: `${origin}/`,
      name: site,
      ...(settings.tagline === '' ? {} : { description: settings.tagline }),
      inLanguage: settings.locale,
      ...(publisherId === undefined ? {} : { publisher: { '@id': publisherId } }),
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${origin}/?s={search_term_string}` },
        'query-input': 'required name=search_term_string',
      },
    },
  ]
  if (publisher?.type === 'organization') {
    nodes.push({
      '@type': 'Organization',
      '@id': publisherId,
      name: publisher.name || site,
      url: `${origin}/`,
      ...(publisher.logo === null ? {} : { logo: imageObject(publisher.logo) }),
    })
  } else if (publisher?.type === 'person') {
    nodes.push({ '@type': 'Person', '@id': publisherId, name: publisher.name, url: absolute(origin, publisher.path) })
  }

  if (content !== undefined && canonical !== undefined) {
    const common = {
      '@id': `${canonical}#main`,
      url: canonical,
      ...(description === undefined ? {} : { description }),
      datePublished: content.publishedAt,
      dateModified: content.modifiedAt,
      inLanguage: settings.locale,
      isPartOf: { '@id': websiteId },
      ...(image === null ? {} : { image: imageObject(image) }),
    }
    if (content.type === 'post') {
      const author = content.authors[0]
      nodes.push({
        '@type': 'BlogPosting',
        headline: context.own,
        ...common,
        mainEntityOfPage: canonical,
        ...(author === undefined
          ? {}
          : { author: { '@type': 'Person', name: author.displayName, url: absolute(origin, author.path) } }),
        ...(publisherId === undefined ? {} : { publisher: { '@id': publisherId } }),
      })
    } else {
      nodes.push({ '@type': 'WebPage', name: context.own, ...common })
    }
  }

  // The breadcrumbs of an inner page: the front page, then a post's first category or a page's parents, or the archive.
  if (!context.isFront && canonical !== undefined) {
    const trail: { name: string; url: string }[] = [{ name: site, url: `${origin}/` }]
    if (content?.type === 'post') {
      const category = content.categories[0]
      if (category !== undefined) trail.push({ name: category.name, url: absolute(origin, category.path) })
    } else if (content !== undefined) {
      for (const parent of content.ancestors) trail.push({ name: parent.title, url: absolute(origin, parent.path) })
    }
    if (content !== undefined || (archive !== undefined && archive.type !== 'home')) {
      trail.push({ name: context.own, url: canonical })
    }
    if (trail.length > 1) {
      nodes.push({
        '@type': 'BreadcrumbList',
        itemListElement: trail.map((crumb, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: crumb.name,
          item: crumb.url,
        })),
      })
    }
  }
  return { '@context': 'https://schema.org', '@graph': nodes }
}
