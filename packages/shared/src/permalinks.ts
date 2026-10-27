// Permalinks (M1.5, K-197, K-221): the address of a post after the structure in «Innstillinger → Permalenker», and the way back from an
// address to the post. WordPress' structures and tags, with its names:
//   Enkel `/?p=123` (empty structure), Dag og navn, Måned og navn, Numerisk, Innleggsnavn (the default, Tor) and Egendefinert.
// Plain functions, used by the api (the addresses it gives and the ones it resolves) and by the admin's screen (the examples).

/** The structure tags WordPress offers on its screen, and what each matches in an address. */
export const PERMALINK_TAGS = {
  '%year%': '(?<year>\\d{4})',
  '%monthnum%': '(?<monthnum>\\d{2})',
  '%day%': '(?<day>\\d{2})',
  '%hour%': '(?<hour>\\d{2})',
  '%minute%': '(?<minute>\\d{2})',
  '%second%': '(?<second>\\d{2})',
  '%post_id%': '(?<post_id>\\d{1,10})',
  '%postname%': '(?<postname>[^/]+)',
  // A category with its parents: `nyheter/lokalt` (WordPress puts the whole path in).
  '%category%': '(?<category>[^/]+(?:/[^/]+)*?)',
  '%author%': '(?<author>[^/]+)',
} as const
export type PermalinkTag = keyof typeof PERMALINK_TAGS

/** WordPress' common structures, by the names of its screen. Innleggsnavn is the default (Tor, M1.5). */
export const PERMALINK_PRESETS = {
  plain: '',
  day: '/%year%/%monthnum%/%day%/%postname%/',
  month: '/%year%/%monthnum%/%postname%/',
  numeric: '/archives/%post_id%',
  postname: '/%postname%/',
} as const
export type PermalinkPreset = keyof typeof PERMALINK_PRESETS

export const DEFAULT_PERMALINK_STRUCTURE = PERMALINK_PRESETS.postname
export const DEFAULT_CATEGORY_BASE = 'category'
export const DEFAULT_TAG_BASE = 'tag'

const TAG = /%[a-z_]+%/g

/** Why a structure cannot be used, or undefined when it can. Empty is «Enkel». */
export function structureProblem(structure: string): string | undefined {
  if (structure === '') return undefined
  if (!structure.startsWith('/')) return 'starts with /'
  if (structure.length > 255) return 'at most 255 characters'
  if (/[\s?#\\]|\/\//.test(structure)) return 'no spaces, ?, #, \\ or //'
  const tags: string[] = structure.match(TAG) ?? []
  const unknown = tags.find((tag) => !(tag in PERMALINK_TAGS))
  if (unknown !== undefined) return `unknown tag ${unknown}`
  if (new Set(tags).size !== tags.length) return 'each tag once'
  if (!tags.includes('%postname%') && !tags.includes('%post_id%')) return 'needs %postname% or %post_id%'
  if (structure.replace(TAG, '').includes('%')) return 'a % that is no tag'
  // Letters, digits and a few marks between the tags: the address is written as the structure says, and read back the same way.
  if (!/^[A-Za-z0-9._~!*'()/-]*$/.test(structure.replace(TAG, '')))
    return "only letters, digits and - . _ ~ ! * ' ( ) between the tags"
  // At most one free-text tag in a segment: two or more make reading an address back slow (each can take any part of the segment).
  for (const segment of structure.split('/')) {
    const free = (segment.match(TAG) ?? []).filter(
      (tag) => tag === '%postname%' || tag === '%category%' || tag === '%author%',
    )
    if (free.length > 1) return 'one of %postname%, %category% and %author% per segment'
  }
  return undefined
}

/** A base (`category`, `emne/tema`) as it may stand in an address: path segments without spaces, query or fragment. */
export function cleanBase(base: string, fallback: string): string {
  const trimmed = base.trim().replace(/^\/+|\/+$/g, '')
  return trimmed === '' ? fallback : trimmed
}

/** What a post's address is made of. Date parts are in the site's time zone. */
export interface PermalinkParts {
  readonly shortId: number
  readonly slug: string
  readonly year: string
  readonly monthnum: string
  readonly day: string
  readonly hour: string
  readonly minute: string
  readonly second: string
  /** The post's category with its parents, `nyheter/lokalt`; only read when the structure has %category%. */
  readonly category: string
  /** The first author's nicename; only read when the structure has %author%. */
  readonly author: string
}

/** The date parts of a moment in a time zone (an IANA name or `+01:00`). */
export function dateParts(
  at: Date,
  timeZone: string,
): Pick<PermalinkParts, 'year' | 'monthnum' | 'day' | 'hour' | 'minute' | 'second'> {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '00'
  return {
    year: get('year'),
    monthnum: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

/** A post's address under a structure. Enkel gives `/?p=<id>`. */
export function postPath(structure: string, parts: PermalinkParts): string {
  if (structure === '') return `/?p=${String(parts.shortId)}`
  return structure.replace(TAG, (tag) => {
    switch (tag as PermalinkTag) {
      case '%year%':
        return parts.year
      case '%monthnum%':
        return parts.monthnum
      case '%day%':
        return parts.day
      case '%hour%':
        return parts.hour
      case '%minute%':
        return parts.minute
      case '%second%':
        return parts.second
      case '%post_id%':
        return String(parts.shortId)
      // Slugs are stored URL-safe (slugSegment's form) and go into the address as they are, as in WordPress.
      case '%postname%':
        return parts.slug
      case '%category%':
        return parts.category
      case '%author%':
        return encodeURIComponent(parts.author)
      default:
        return tag
    }
  })
}

/** What an address told about a post: the tags it matched (decoded), and the page of a post split by page breaks. */
export type PermalinkMatch = Partial<
  Record<
    'year' | 'monthnum' | 'day' | 'hour' | 'minute' | 'second' | 'post_id' | 'postname' | 'category' | 'author',
    string
  >
> & {
  readonly page: number
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Reads a path in slugSegment's form (`/2026/10/hei/`, `/archives/12/2/`) against a structure: the tags it holds, or undefined when it does not fit. The
 * closing slash is optional, and a page number may follow (`/hei/2/`, WordPress' split posts). Enkel matches nothing: its address is
 * a query (`?p=`).
 */
export function matchPostPath(structure: string, path: string): PermalinkMatch | undefined {
  if (structure === '' || path.length > 2000) return undefined
  const body = structure
    .replace(/\/+$/, '')
    .split(TAG)
    .map(escape)
    .reduce<string[]>((out, literal, index) => {
      out.push(literal)
      const tag = (structure.replace(/\/+$/, '').match(TAG) ?? [])[index] as PermalinkTag | undefined
      if (tag !== undefined) out.push(PERMALINK_TAGS[tag])
      return out
    }, [])
    .join('')
  const found = new RegExp(`^${body}(?:/(?<page>\\d{1,5}))?/?$`).exec(path)
  if (found?.groups === undefined) return undefined
  const result: Record<string, string | number> = {
    page: found.groups['page'] === undefined ? 1 : Number(found.groups['page']),
  }
  // A group that matched nothing is undefined at run time, whatever the type says. The values are in the address' form (slugSegment).
  for (const [name, value] of Object.entries(found.groups as Record<string, string | undefined>)) {
    if (name !== 'page' && value !== undefined) result[name] = value
  }
  return result as PermalinkMatch
}
