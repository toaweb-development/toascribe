// WordPress' parsed blocks (parse_blocks(): blockName, attrs, innerBlocks, innerHTML, innerContent) as toascribe blocks (M1.4). The
// install stored the default content («Hei, verden!», the sample page, the privacy policy) in WordPress' form until M1.3 had blocks of
// its own; this turns it, and later the WXR import (phase 2), into the block format. The HTML of a block becomes rich text as data
// (inline.ts): text, bold, italic, code, links that isSafeHref allows, and line breaks; any other tag is dropped and its text kept, an
// unknown entity is left as it is. A block type it does not know makes the whole tree undefined, so nothing is half converted.
import type { Block } from './block.ts'
import { createBlock } from './block.ts'
import type { InlineMark, InlineNode } from './inline.ts'
import { isSafeHref, normalizeInline } from './inline.ts'
import { validateDocument } from './validate.ts'

/** One node as WordPress' parse_blocks() returns it. */
export interface WordPressBlock {
  readonly blockName: string | null
  readonly attrs: Readonly<Record<string, unknown>>
  readonly innerBlocks: readonly WordPressBlock[]
  readonly innerHTML: string
  readonly innerContent?: readonly (string | null)[]
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  laquo: '«',
  raquo: '»',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
}

/** Decodes the entities of HTML text: named ones from the list, and numeric ones. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) {
      const code = Number.parseInt(name.slice(2), 16)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    if (name.startsWith('#')) {
      const code = Number.parseInt(name.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[name.toLowerCase()] ?? whole
  })
}

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^>]*?)?)\s*(\/?)>/g

function attribute(attrs: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs)
  const value = match?.[2] ?? match?.[3] ?? match?.[4]
  return value === undefined ? undefined : decodeEntities(value)
}

/**
 * Inline HTML as rich text: `<strong>`/`<b>` bold, `<em>`/`<i>` italic, `<code>` code, `<a href>` a link when its address is allowed,
 * `<br>` a hard break. Other tags are dropped and their text kept; whitespace is kept as it is (a paragraph's HTML has none to spare).
 */
export function inlineFromHtml(html: string): InlineNode[] {
  const nodes: unknown[] = []
  const marks: { tag: string; mark?: InlineMark }[] = []
  let offset = 0
  const pushText = (raw: string) => {
    const text = decodeEntities(raw)
    if (text === '') return
    const active = marks.map((entry) => entry.mark).filter((mark) => mark !== undefined)
    nodes.push(active.length > 0 ? { type: 'text', text, marks: active } : { type: 'text', text })
  }
  for (const match of html.matchAll(TAG)) {
    pushText(html.slice(offset, match.index))
    offset = match.index + match[0].length
    const [, closing, rawName = '', attrs = ''] = match
    const name = rawName.toLowerCase()
    if (name === 'br') {
      nodes.push({ type: 'hardBreak' })
      continue
    }
    if (closing === '/') {
      const at = marks.map((entry) => entry.tag).lastIndexOf(name)
      if (at !== -1) marks.splice(at, 1)
      continue
    }
    let mark: InlineMark | undefined
    if (name === 'strong' || name === 'b') mark = { type: 'bold' }
    else if (name === 'em' || name === 'i') mark = { type: 'italic' }
    else if (name === 'code') mark = { type: 'code' }
    else if (name === 'a') {
      const href = attribute(attrs, 'href')
      if (href !== undefined && isSafeHref(href)) mark = { type: 'link', attrs: { href } }
    }
    marks.push({ tag: name, ...(mark === undefined ? {} : { mark }) })
  }
  pushText(html.slice(offset))
  // normalizeInline puts marks in their order, drops a code mark's companions as the schema needs, and joins equal runs.
  return normalizeInline(
    nodes.map((node) => {
      if (typeof node !== 'object' || node === null || !('marks' in node)) return node
      const list = (node as { marks: InlineMark[] }).marks
      return list.some((mark) => mark.type === 'code') ? { ...node, marks: [{ type: 'code' }] } : node
    }),
  )
}

/** The HTML inside the outermost element of a block's HTML (`<p>…</p>` → `…`), trimmed of the newlines WordPress puts around it. */
function innerOf(html: string, tag: string): string {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*)</${tag}>`, 'i').exec(html.trim())
  return match?.[1] ?? html.trim()
}

function convert(block: WordPressBlock): Block | undefined {
  const name = block.blockName
  const html = block.innerHTML
  switch (name) {
    case 'core/paragraph':
      return createBlock('core/paragraph', { content: inlineFromHtml(innerOf(html, 'p')) })
    case 'core/heading': {
      const level = typeof block.attrs['level'] === 'number' ? block.attrs['level'] : 2
      return createBlock('core/heading', { level, content: inlineFromHtml(innerOf(html, `h${String(level)}`)) })
    }
    case 'core/quote': {
      const children = convertAll(block.innerBlocks)
      const cite = /<cite[^>]*>([\s\S]*?)<\/cite>/i.exec(html)?.[1]
      return children === undefined || children.length === 0
        ? undefined
        : createBlock('core/quote', { citation: cite === undefined ? [] : inlineFromHtml(cite) }, children)
    }
    case 'core/list': {
      const items = convertAll(block.innerBlocks)
      return items === undefined || items.length === 0
        ? undefined
        : createBlock('core/list', { ordered: block.attrs['ordered'] === true }, items)
    }
    case 'core/list-item': {
      const nested = convertAll(block.innerBlocks)
      if (nested === undefined) return undefined
      // The item's own text is its HTML before a nested list.
      const own = innerOf(html, 'li').replace(/<(ul|ol)[\s\S]*$/i, '')
      return createBlock('core/list-item', { content: inlineFromHtml(own) }, nested.slice(0, 1))
    }
    case 'core/separator':
      return createBlock('core/separator')
    case 'core/code':
      return createBlock('core/code', { content: decodeEntities(innerOf(innerOf(html, 'pre'), 'code')) })
    case 'core/preformatted':
      return createBlock('core/preformatted', { content: inlineFromHtml(innerOf(html, 'pre').replace(/\n/g, '<br>')) })
    case 'core/group': {
      const children = convertAll(block.innerBlocks)
      return children === undefined || children.length === 0 ? undefined : createBlock('core/group', {}, children)
    }
    case 'core/more':
      return createBlock('core/more', {
        customText: typeof block.attrs['customText'] === 'string' ? block.attrs['customText'] : '',
        noTeaser: block.attrs['noTeaser'] === true,
      })
    case 'core/nextpage':
      return createBlock('core/nextpage')
    case 'core/html':
      // WordPress' own custom HTML: written by someone with unfiltered_html there, kept as it is.
      return createBlock('core/html', { content: html.trim() })
    default:
      return undefined
  }
}

function convertAll(blocks: readonly WordPressBlock[]): Block[] | undefined {
  const out: Block[] = []
  for (const block of blocks) {
    // Whitespace between blocks (a freeform block with no name and blank HTML) is nothing.
    if (block.blockName === null && block.innerHTML.trim() === '') continue
    const converted = convert(block)
    if (converted === undefined) return undefined
    out.push(converted)
  }
  return out
}

/** True for a stored tree in WordPress' parsed form (its blocks have `blockName`). */
export function isWordPressTree(input: unknown): input is WordPressBlock[] {
  return (
    Array.isArray(input) &&
    input.length > 0 &&
    input.every((block) => typeof block === 'object' && block !== null && 'blockName' in block && 'innerHTML' in block)
  )
}

/**
 * A tree in WordPress' parsed form as toascribe blocks that pass validateDocument; undefined when a block type is unknown or the
 * result does not pass (a text over its length, an image without a file).
 */
export function fromWordPress(input: readonly WordPressBlock[]): Block[] | undefined {
  const blocks = convertAll(input)
  if (blocks === undefined) return undefined
  const checked = validateDocument(blocks)
  return checked.ok ? checked.blocks : undefined
}
