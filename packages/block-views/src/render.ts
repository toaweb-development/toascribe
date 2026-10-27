// How each core block looks on the site (PLAN «Regler for blokker» 3 and 6, K-078, K-079): plain semantic HTML that the server
// renders, with no script and no style attribute (the site's CSP has no 'unsafe-inline'; sizes and columns are classes a theme
// styles). Every element is made by Vue from the block's data: rich text is built node by node from the stored JSON (inline.ts is its
// allow-list), and text is always printed as text. The one exception is the custom HTML block, whose raw HTML is written as it is:
// only an account with unfiltered_html can put one there or change it (the api checks it on every save, permissions.ts).
//
// Render functions in TypeScript rather than single-file components: the package is a plain library that the api's tests, the admin
// and the site load without a Vue compiler, and each function is tested on its own with the server renderer (test/views.test.ts).
// A theme overrides a block's view in M1.4 (PLAN «Regler for blokker» 6); the class names here are the contract it styles.
import { h } from 'vue'
import type { VNode, VNodeChild } from 'vue'

import type { Block, InlineMark, InlineNode } from '@toascribe/blocks'
import {
  BUTTON,
  BUTTONS,
  CODE,
  COLUMN,
  COLUMNS,
  GALLERY,
  GROUP,
  HEADING,
  HTML,
  IMAGE,
  LIST,
  LIST_ITEM,
  MORE,
  NEXTPAGE,
  PARAGRAPH,
  PREFORMATTED,
  QUOTE,
  SEPARATOR,
  SPACER,
  TABLE,
  isSafeHref,
} from '@toascribe/blocks'
import type { ContentMediaRef } from '@toascribe/shared'

/** What a view needs beyond the block: the media its images use, by id. */
export interface ViewContext {
  readonly media: ReadonlyMap<string, ContentMediaRef>
  /** `sizes` for an image that fills the content column (a theme knows its width; the default is the admin preview's 48rem). */
  readonly imageSizes: string
}

function text(block: Block, key: string): string {
  const value = block.attrs[key]
  return typeof value === 'string' ? value : ''
}

function inline(block: Block, key: string): readonly InlineNode[] {
  const value = block.attrs[key]
  return Array.isArray(value) ? (value as InlineNode[]) : []
}

/** One mark around its content. A link whose address is not allowed (data changed behind the api's back) is plain text. */
function wrap(mark: InlineMark, content: VNodeChild): VNodeChild {
  switch (mark.type) {
    case 'bold':
      return h('strong', null, [content])
    case 'italic':
      return h('em', null, [content])
    case 'code':
      return h('code', null, [content])
    case 'link':
      return isSafeHref(mark.attrs.href) ? h('a', { href: mark.attrs.href }, [content]) : content
    default:
      return mark satisfies never
  }
}

/** Rich text as elements: each text node with its marks (the first mark outermost), a hard break as <br>. */
export function renderInline(nodes: readonly InlineNode[]): VNodeChild[] {
  return nodes.map((node) => {
    if (node.type === 'hardBreak') {
      return h('br')
    }
    return [...(node.marks ?? [])].reverse().reduce<VNodeChild>((inner, mark) => wrap(mark, inner), node.text)
  })
}

/** The srcset of an image from its generated sizes and the shown image, widest last. */
export function srcsetOf(image: ContentMediaRef): string | undefined {
  const entries = image.sizes.map((size) => `${size.url} ${String(size.width)}w`)
  if (image.width !== null) entries.push(`${image.url} ${String(image.width)}w`)
  return entries.length > 1 ? entries.join(', ') : undefined
}

function imageElement(image: ContentMediaRef, block: Block, sizes: string): VNode {
  return h('img', {
    src: image.url,
    srcset: srcsetOf(image),
    sizes: srcsetOf(image) === undefined ? undefined : sizes,
    width: image.width ?? undefined,
    height: image.height ?? undefined,
    // A decorative image is skipped by a screen reader (WCAG 1.1.1); every other one has its alt text (validate.ts requires it).
    alt: block.attrs['decorative'] === true ? '' : text(block, 'alt'),
    loading: 'lazy',
    decoding: 'async',
  })
}

/** An image: a figure with the picture and its caption, or nothing while no file is chosen (or the file is gone). */
function imageView(block: Block, context: ViewContext, gallery?: { linkTo: string; sizes: string }): VNode | null {
  const image = context.media.get(text(block, 'mediaId'))
  if (image === undefined) {
    return null
  }
  const picture = imageElement(image, block, gallery?.sizes ?? context.imageSizes)
  const caption = text(block, 'caption')
  return h('figure', { class: 'block-image' }, [
    gallery?.linkTo === 'file' ? h('a', { href: image.url }, [picture]) : picture,
    caption === '' ? null : h('figcaption', null, caption),
  ])
}

function children(block: Block, context: ViewContext): VNodeChild[] {
  return block.children.map((child) => renderBlock(child, context))
}

function listItems(block: Block, context: ViewContext): VNodeChild[] {
  return block.children.map((item) =>
    h('li', { key: item.id }, [...renderInline(inline(item, 'content')), ...children(item, context)]),
  )
}

function tableView(block: Block): VNode | null {
  const value = block.attrs['cells']
  const rows = Array.isArray(value) ? (value as InlineNode[][][]) : []
  // A table with no text in any cell shows nothing (an empty header cell is an error for a screen reader).
  if (rows.every((row) => row.every((cell) => cell.length === 0))) {
    return null
  }
  const hasHeader = block.attrs['hasHeader'] === true && rows.length > 0
  const head = hasHeader ? rows[0] : undefined
  const body = hasHeader ? rows.slice(1) : rows
  const caption = text(block, 'caption')
  return h('figure', { class: 'block-table' }, [
    h('table', null, [
      head === undefined
        ? null
        : h('thead', null, [
            h(
              'tr',
              null,
              head.map((cell) => h('th', { scope: 'col' }, renderInline(cell))),
            ),
          ]),
      h(
        'tbody',
        null,
        body.map((row) =>
          h(
            'tr',
            null,
            row.map((cell) => h('td', null, renderInline(cell))),
          ),
        ),
      ),
    ]),
    caption === '' ? null : h('figcaption', null, caption),
  ])
}

function galleryView(block: Block, context: ViewContext): VNode | null {
  const columns = typeof block.attrs['columns'] === 'number' ? block.attrs['columns'] : 3
  const linkTo = text(block, 'linkTo')
  // Each image takes a column's share of the width on a wide screen, the whole width on a phone (two columns from the small size).
  const sizes = `(min-width: 48rem) calc(48rem / ${String(columns)}), 50vw`
  const images = block.children
    .map((child) => imageView(child, context, { linkTo, sizes }))
    .filter((node) => node !== null)
  if (images.length === 0) {
    return null
  }
  return h(
    'figure',
    { class: ['block-gallery', `columns-${String(columns)}`, block.attrs['crop'] === true ? 'is-cropped' : null] },
    images,
  )
}

function buttonView(block: Block): VNode {
  const url = text(block, 'url')
  const variant = text(block, 'variant') === 'outline' ? 'is-outline' : 'is-fill'
  const content = renderInline(inline(block, 'text'))
  // Without an address it is no link: plain text in the button's shape, not an <a> that goes nowhere.
  return url !== '' && isSafeHref(url)
    ? h('a', { class: ['block-button', variant], href: url }, content)
    : h('span', { class: ['block-button', variant] }, content)
}

/** One block as HTML, or null for a block that shows nothing here (an image without a file, «Les mer», a page break). */
export function renderBlock(block: Block, context: ViewContext): VNode | null {
  switch (block.type) {
    case PARAGRAPH:
      return h('p', null, renderInline(inline(block, 'content')))
    case HEADING: {
      // An empty heading is no heading (WCAG 1.3.1, axe empty-heading): nothing until it has text.
      if (inline(block, 'content').length === 0) return null
      const level = typeof block.attrs['level'] === 'number' ? Math.min(6, Math.max(1, block.attrs['level'])) : 2
      return h(`h${String(level)}`, null, renderInline(inline(block, 'content')))
    }
    case LIST:
      return h(block.attrs['ordered'] === true ? 'ol' : 'ul', { class: 'block-list' }, listItems(block, context))
    case LIST_ITEM:
      // Only inside a list, which draws its items itself.
      return null
    case QUOTE: {
      const citation = inline(block, 'citation')
      return h('blockquote', { class: 'block-quote' }, [
        ...children(block, context),
        citation.length === 0 ? null : h('cite', null, renderInline(citation)),
      ])
    }
    case CODE:
      return h('pre', { class: 'block-code' }, [h('code', null, text(block, 'content'))])
    case PREFORMATTED:
      return h('pre', { class: 'block-preformatted' }, renderInline(inline(block, 'content')))
    case TABLE:
      return tableView(block)
    case IMAGE:
      return imageView(block, context)
    case GALLERY:
      return galleryView(block, context)
    case BUTTONS:
      return h('div', { class: 'block-buttons' }, block.children.map(buttonView))
    case BUTTON:
      return buttonView(block)
    case COLUMNS:
      return h(
        'div',
        { class: ['block-columns', `columns-${String(block.children.length)}`] },
        block.children.map((column) => renderBlock(column, context)),
      )
    case COLUMN:
      return h('div', { class: 'block-column' }, children(block, context))
    case GROUP:
      return h('div', { class: 'block-group' }, children(block, context))
    case SEPARATOR:
      return h('hr', { class: 'block-separator' })
    case SPACER:
      return h('div', { class: ['block-spacer', `is-${text(block, 'size') || 'medium'}`], 'aria-hidden': 'true' })
    case MORE:
    case NEXTPAGE:
      // «Les mer» marks where an archive's excerpt ends and a page break where a page ends (K-107, K-227): the site uses them when
      // it lists or pages a post (M1.4). In the whole post they show nothing.
      return null
    case HTML:
      // Raw HTML by design: only unfiltered_html may write it (see the top of this file). Scripts still need the page's nonce.
      return h('div', { class: 'block-html', innerHTML: text(block, 'content') })
    default:
      // A block the views do not know (from an extension that is not active): nothing, rather than its data (PLAN «Regler» 4).
      return null
  }
}

/** A whole document. The blocks must have passed validateDocument (the api stores nothing else). */
export function renderDocument(blocks: readonly Block[], context: ViewContext): VNode {
  return h(
    'div',
    { class: 'blocks' },
    blocks.map((block) => renderBlock(block, context)),
  )
}
