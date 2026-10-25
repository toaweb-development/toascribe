import { createHash } from 'node:crypto'

import { ADMIN_STYLE_ATTRIBUTES } from '../../csp-style-attributes.ts'

// The inline `style` attributes in the HTML the server sends, and the list the CSP lets through (csp-style-attributes.ts).

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }

/** Every `style="…"` attribute value in a page's HTML, as the browser reads it (entities decoded), once each. */
export function styleAttributesIn(html: string): string[] {
  const found = new Set<string>()
  for (const [, value] of html.matchAll(/<[a-z][^>]*?\sstyle="([^"]*)"/gi)) {
    found.add((value ?? '').replaceAll(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity))
  }
  return [...found]
}

/** The CSP source for one string: what the browser compares an inline style attribute with. */
export const sha256Source = (text: string): string => `'sha256-${createHash('sha256').update(text).digest('base64')}'`

/** The strings on the list. */
export const LISTED_STYLE_ATTRIBUTES: readonly string[] = ADMIN_STYLE_ATTRIBUTES.map(({ value }) => value)

/** The value `style-src-attr` must have: `'unsafe-hashes'` and the hash of each listed string, in the list's order. */
export const EXPECTED_STYLE_SRC_ATTR = ["'unsafe-hashes'", ...LISTED_STYLE_ATTRIBUTES.map(sha256Source)].join(' ')
