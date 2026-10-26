// Content slugs as WordPress makes them (K-060, PLAN «Datamodell»): `sanitize_title()` in the `save` context, which runs
// `remove_accents()` and then `sanitize_title_with_dashes()` (wp-includes/formatting.php, trunk as of 2026-10-26). A slug is
// lower-case ASCII letters, digits, `_` and `-`; what has no ASCII form is kept percent-encoded (`%e6%97%a5`), as WordPress
// stores it. Plain TypeScript, no Node or browser API, so the api, the worker and the admin give the same answer.
import { REMOVE_ACCENTS_TABLE } from './slug-accents.ts'

/** WordPress' `post_name` column holds 200 characters, and `sanitize_title_with_dashes` encodes at most that. */
export const MAX_SLUG_LENGTH = 200

/** What a trashed item's slug ends with until it is restored (WordPress `wp_add_trashed_suffix_to_post_name_for_post`). */
export const TRASHED_SLUG_SUFFIX = '__trashed'

/** The changes to the table that `remove_accents()` makes for some locales. toascribe locales are BCP 47 (`de-AT`, `da`). */
function localeChanges(locale: string): Readonly<Record<string, string>> {
  const tag = locale.toLowerCase().replace('_', '-')
  if (tag.startsWith('de')) {
    return { Ä: 'Ae', ä: 'ae', Ö: 'Oe', ö: 'oe', Ü: 'Ue', ü: 'ue', ẞ: 'SS', ß: 'ss' }
  }
  if (tag === 'da' || tag === 'da-dk') {
    return { Æ: 'Ae', æ: 'ae', Ø: 'Oe', ø: 'oe', Å: 'Aa', å: 'aa' }
  }
  if (tag === 'sr' || tag.startsWith('sr-') || tag === 'bs' || tag.startsWith('bs-')) {
    return { Đ: 'DJ', đ: 'dj' }
  }
  return {}
}

/**
 * WordPress' `remove_accents()` for a UTF-8 string: NFC first, then the character table (with the locale's changes). Norwegian
 * uses the common table: «æ» becomes «ae», «ø» «o», «å» «a».
 */
export function removeAccents(text: string, locale = ''): string {
  // eslint-disable-next-line no-control-regex -- the same test as WordPress' /[\x80-\xff]/: nothing outside ASCII, nothing to do
  if (!/[^\u0000-\u007f]/.test(text)) {
    return text
  }
  let normalized = text.normalize('NFC')
  const tag = locale.toLowerCase().replace('_', '-')
  if (tag === 'ca' || tag.startsWith('ca-')) {
    // WordPress' only entry of more than one character; `strtr` matches it before its parts.
    normalized = normalized.replaceAll('l·l', 'll')
  }
  const changes = localeChanges(locale)
  let result = ''
  for (const character of normalized) {
    result += changes[character] ?? REMOVE_ACCENTS_TABLE[character] ?? character
  }
  return result
}

/** WordPress' `utf8_uri_encode($text, $length)`: ASCII as it is, everything else as lower-case `%xx` of its UTF-8 bytes, cut at `length`. */
function utf8UriEncode(text: string, length: number): string {
  const encoder = new TextEncoder()
  let result = ''
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    const encoded =
      code < 0x80
        ? character
        : [...encoder.encode(character)].map((byte) => `%${byte.toString(16).padStart(2, '0')}`).join('')
    if (result.length + encoded.length > length) {
      break
    }
    result += encoded
  }
  return result
}

/** Removed in the save context (soft hyphen, ¡ ¿, angle and curly quotes, bullet, © ® ° … ™, accents, invisible characters). */
const STRIPPED = [
  '%c2%ad',
  '%c2%a1',
  '%c2%bf',
  '%c2%ab',
  '%c2%bb',
  '%e2%80%b9',
  '%e2%80%ba',
  '%e2%80%98',
  '%e2%80%99',
  '%e2%80%9c',
  '%e2%80%9d',
  '%e2%80%9a',
  '%e2%80%9b',
  '%e2%80%9e',
  '%e2%80%9f',
  '%e2%80%a2',
  '%c2%a9',
  '%c2%ae',
  '%c2%b0',
  '%e2%80%a6',
  '%e2%84%a2',
  '%c2%b4',
  '%cb%8a',
  '%cc%81',
  '%cd%81',
  '%cc%80',
  '%cc%84',
  '%cc%8c',
  '%e2%80%8b',
  '%e2%80%8c',
  '%e2%80%8d',
  '%e2%80%8e',
  '%e2%80%8f',
  '%e2%80%aa',
  '%e2%80%ab',
  '%e2%80%ac',
  '%e2%80%ad',
  '%e2%80%ae',
  '%ef%bb%bf',
  '%ef%bf%bc',
] as const

/** Turned into a hyphen in the save context: the spaces that have a width, and nbsp, non-breaking hyphen, en and em dash. */
const HYPHENATED = [
  '%c2%a0',
  '%e2%80%91',
  '%e2%80%93',
  '%e2%80%94',
  '&nbsp;',
  '&#8209;',
  '&#160;',
  '&ndash;',
  '&#8211;',
  '&mdash;',
  '&#8212;',
  '%e2%80%80',
  '%e2%80%81',
  '%e2%80%82',
  '%e2%80%83',
  '%e2%80%84',
  '%e2%80%85',
  '%e2%80%86',
  '%e2%80%87',
  '%e2%80%88',
  '%e2%80%89',
  '%e2%80%8a',
  '%e2%80%a8',
  '%e2%80%a9',
  '%e2%80%af',
] as const

/** WordPress' `sanitize_title_with_dashes($title, '', 'save')`. */
export function sanitizeTitleWithDashes(title: string): string {
  let text = title.replace(/<[^>]*(>|$)/g, '')
  // Keep escaped octets, drop every other percent sign.
  text = text.replace(/%([a-fA-F0-9][a-fA-F0-9])/g, '---$1---')
  text = text.replaceAll('%', '')
  text = text.replace(/---([a-fA-F0-9][a-fA-F0-9])---/g, '%$1')
  text = utf8UriEncode(text.toLowerCase(), MAX_SLUG_LENGTH).toLowerCase()

  // The order is WordPress': first the hyphens (the first four octets and entities come before the slash), then the slash,
  // then the characters that are removed, then the wide spaces, then the multiplication sign.
  for (const sequence of HYPHENATED.slice(0, 11)) {
    text = text.replaceAll(sequence, '-')
  }
  text = text.replaceAll('/', '-')
  for (const sequence of STRIPPED) {
    text = text.replaceAll(sequence, '')
  }
  for (const sequence of HYPHENATED.slice(11)) {
    text = text.replaceAll(sequence, '-')
  }
  text = text.replaceAll('%c3%97', 'x')

  text = text.replace(/&.+?;/g, '')
  text = text.replaceAll('.', '-')
  text = text.replace(/[^%a-z0-9 _-]/g, '')
  text = text.replace(/\s+/g, '-')
  text = text.replace(/-+/g, '-')
  return text.replace(/^-+|-+$/g, '')
}

/**
 * WordPress' `sanitize_title($title, $fallback)` in the save context, as `wp_insert_post` runs it on a title and on a slug that
 * was typed: «Blåbær på Ørland» becomes `blabaer-pa-orland`. Returns `fallback` when nothing is left.
 */
export function sanitizeTitle(title: string, fallback = '', locale = ''): string {
  const slug = sanitizeTitleWithDashes(removeAccents(title, locale))
  return slug === '' ? fallback : slug
}

/**
 * WordPress' `_truncate_post_slug` / `wp_truncate_slug`: at most `length` characters, never in the middle of a `%xx` sequence or
 * of the bytes of one character.
 */
export function truncateSlug(slug: string, length: number = MAX_SLUG_LENGTH): string {
  if (slug.length <= length) {
    return slug
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(slug)
  } catch {
    return slug.slice(0, length)
  }
  return decoded === slug ? slug.slice(0, length) : utf8UriEncode(decoded, length)
}

/** The slug a trashed item gets: the slug, cut to leave room, and `__trashed` (WordPress cuts at 191). */
export function trashedSlug(slug: string): string {
  return `${truncateSlug(slug, MAX_SLUG_LENGTH - TRASHED_SLUG_SUFFIX.length)}${TRASHED_SLUG_SUFFIX}`
}

/** The slug of a trashed item without its trash suffix (and the number a clash between two trashed items added after it). */
export function untrashedSlug(slug: string): string {
  return slug.replace(/__trashed(-\d+)?$/, '')
}
