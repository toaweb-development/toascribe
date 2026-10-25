// Rich text inside a block (a `rich-text` attribute): the inline content of one paragraph as data, never as HTML.
//
// The shape is the content of a ProseMirror paragraph as TipTap writes it with `getJSON()`, cut down to what the prototype
// allows: text nodes with the marks bold, italic, code and link, and hard breaks. Storing data instead of an HTML string means
// that nothing has to be sanitised on the way in and nothing is ever handed to `v-html` on the way out: the schema below is the
// allow-list (it plays the part of WordPress' kses), and the view builds elements from it. A mark or node it does not know, or an
// attribute on one, is refused.
import { z } from 'zod'

/** The schemes a link may use. Anything else (javascript:, data:, vbscript:, file:) is refused. */
const LINK_SCHEMES = ['http:', 'https:', 'mailto:'] as const

/** The longest link or image address that is stored. */
export const MAX_URL_LENGTH = 2048

/** Characters that a browser drops from a URL before it reads the scheme (C0 controls, space, DEL), so `java\tscript:` is refused too. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const IGNORED_IN_SCHEME = /[\u0000- \u007f]/

/**
 * True for an address a link may point to: `http:`, `https:` or `mailto:`, a path on this site (`/…`, not `//…`, which is
 * another host), or a fragment (`#…`). Control characters and backslashes are refused anywhere, because browsers read them in
 * ways that differ from `URL` (`/\evil.example` is another host to some).
 */
export function isSafeHref(value: string): boolean {
  if (value === '' || value.length > MAX_URL_LENGTH || IGNORED_IN_SCHEME.test(value) || value.includes('\\')) {
    return false
  }
  if (value.startsWith('#')) {
    return true
  }
  if (value.startsWith('/')) {
    return !value.startsWith('//')
  }
  try {
    const url = new URL(value)
    return LINK_SCHEMES.some((scheme) => scheme === url.protocol) && (url.protocol === 'mailto:' || url.host !== '')
  } catch {
    return false
  }
}

/** True for the address of an image: `http:` or `https:`, or a path on this site. Never `data:` or another scheme. */
export function isSafeMediaUrl(value: string): boolean {
  if (!isSafeHref(value) || value.startsWith('#') || value.startsWith('mailto:')) {
    return false
  }
  return true
}

const SafeHref = z.string().max(MAX_URL_LENGTH).refine(isSafeHref, { message: 'Not an allowed link address' })

export const InlineMark = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('bold') }),
  z.strictObject({ type: z.literal('italic') }),
  z.strictObject({ type: z.literal('code') }),
  z.strictObject({ type: z.literal('link'), attrs: z.strictObject({ href: SafeHref }) }),
])
export type InlineMark = z.infer<typeof InlineMark>
export type InlineMarkType = InlineMark['type']

export const InlineText = z.strictObject({
  type: z.literal('text'),
  // ProseMirror never writes an empty text node, so neither may the stored content.
  text: z.string().min(1),
  marks: z.array(InlineMark).max(4).optional(),
})
export type InlineText = z.infer<typeof InlineText>

export const InlineBreak = z.strictObject({ type: z.literal('hardBreak') })
export type InlineBreak = z.infer<typeof InlineBreak>

export const InlineNode = z.discriminatedUnion('type', [InlineText, InlineBreak])
export type InlineNode = z.infer<typeof InlineNode>

/** The most nodes one rich-text attribute may hold (a node per change of formatting). */
export const MAX_INLINE_NODES = 2000

/**
 * The schema of one rich-text value, with the most characters it may hold. Each mark type appears at most once per node, and a
 * code mark stands alone, as TipTap's schema has it (`code` excludes the other marks).
 */
export function inlineContentSchema(maxLength: number) {
  return z
    .array(InlineNode)
    .max(MAX_INLINE_NODES)
    .superRefine((nodes, ctx) => {
      let length = 0
      nodes.forEach((node, index) => {
        if (node.type === 'hardBreak') {
          length += 1
          return
        }
        length += node.text.length
        const types = (node.marks ?? []).map((mark) => mark.type)
        if (new Set(types).size !== types.length) {
          ctx.addIssue({ code: 'custom', path: [index, 'marks'], message: 'A mark appears twice' })
        }
        if (types.includes('code') && types.length > 1) {
          ctx.addIssue({ code: 'custom', path: [index, 'marks'], message: 'Code cannot be combined with other marks' })
        }
      })
      if (length > maxLength) {
        ctx.addIssue({ code: 'custom', path: [], message: `More than ${String(maxLength)} characters` })
      }
    })
}

export type InlineContent = InlineNode[]

/** The plain text of inline content (a hard break is a line break). For search, counts and tests. */
export function inlineText(content: readonly InlineNode[]): string {
  return content.map((node) => (node.type === 'text' ? node.text : '\n')).join('')
}

/** The length of inline content as an editor counts positions: one per character, one per hard break. */
export function inlineLength(content: readonly InlineNode[]): number {
  return content.reduce((sum, node) => sum + (node.type === 'text' ? node.text.length : 1), 0)
}

function sameMarks(a: readonly InlineMark[] | undefined, b: readonly InlineMark[] | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
}

/** Joins two runs of inline content, merging the text nodes where they meet when their marks are the same (as ProseMirror does). */
export function joinInline(a: readonly InlineNode[], b: readonly InlineNode[]): InlineNode[] {
  const last = a.at(-1)
  const first = b[0]
  if (last?.type === 'text' && first?.type === 'text' && sameMarks(last.marks, first.marks)) {
    return [...a.slice(0, -1), { ...last, text: last.text + first.text }, ...b.slice(1)]
  }
  return [...a, ...b]
}

/**
 * Normalises what a TipTap editor returns (`editor.getJSON()` for a document of one paragraph, or the paragraph's `content`) to
 * the stored shape: only the known nodes and marks, only the attribute `href` of a link (TipTap adds target, rel and class), no
 * empty text, marks in a fixed order. Whatever does not fit is dropped here; the schema then checks the result.
 */
export function normalizeInline(input: unknown): InlineNode[] {
  if (!Array.isArray(input)) {
    return []
  }
  const order: Record<InlineMarkType, number> = { link: 0, bold: 1, italic: 2, code: 3 }
  const result: InlineNode[] = []
  for (const raw of input as unknown[]) {
    if (typeof raw !== 'object' || raw === null) {
      continue
    }
    const type: unknown = Reflect.get(raw, 'type')
    if (type === 'hardBreak') {
      result.push({ type: 'hardBreak' })
      continue
    }
    const text: unknown = Reflect.get(raw, 'text')
    if (type !== 'text' || typeof text !== 'string' || text === '') {
      continue
    }
    const marks: InlineMark[] = []
    const rawMarks: unknown = Reflect.get(raw, 'marks')
    for (const mark of Array.isArray(rawMarks) ? (rawMarks as unknown[]) : []) {
      if (typeof mark !== 'object' || mark === null) {
        continue
      }
      const markType: unknown = Reflect.get(mark, 'type')
      if (markType === 'bold' || markType === 'italic' || markType === 'code') {
        marks.push({ type: markType })
      } else if (markType === 'link') {
        const attrs: unknown = Reflect.get(mark, 'attrs')
        const href: unknown = typeof attrs === 'object' && attrs !== null ? Reflect.get(attrs, 'href') : undefined
        if (typeof href === 'string' && isSafeHref(href)) {
          marks.push({ type: 'link', attrs: { href } })
        }
      }
    }
    marks.sort((x, y) => order[x.type] - order[y.type])
    const node: InlineText = marks.length > 0 ? { type: 'text', text, marks } : { type: 'text', text }
    const previous = result.at(-1)
    if (previous?.type === 'text' && sameMarks(previous.marks, node.marks)) {
      result[result.length - 1] = { ...previous, text: previous.text + text }
    } else {
      result.push(node)
    }
  }
  return result
}
