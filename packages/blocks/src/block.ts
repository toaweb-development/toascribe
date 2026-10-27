// One block as it is stored (PLAN, «Slik lagres en blokk»): `id`, `type`, `version`, `attrs` and `children`. A document is the
// array of its top-level blocks. Blocks are treated as immutable values: every change makes new objects along the path from the
// top to the block that changed (tree.ts), so an unchanged block keeps its identity. That is what lets the editor's history keep a
// whole document per step at the cost of one path, and what lets Vue skip the blocks that did not change.
import { defaultAttrs } from './definition.ts'
import {
  BUTTON,
  BUTTONS,
  COLUMN,
  COLUMNS,
  GROUP,
  LIST,
  LIST_ITEM,
  PARAGRAPH,
  QUOTE,
  getBlockDefinition,
} from './registry.ts'
import type { InlineNode } from './inline.ts'

export interface Block {
  readonly id: string
  readonly type: string
  readonly version: number
  readonly attrs: Readonly<Record<string, unknown>>
  readonly children: readonly Block[]
}

export type BlockDocument = readonly Block[]

/** `b_` and 4 to 40 characters from the URL-safe alphabet (PLAN's example is `b_7f3a`). */
export const BLOCK_ID_PATTERN = /^b_[A-Za-z0-9_-]{4,40}$/

/** A new random block id: `b_` and 12 hex characters (48 bits), from the platform's crypto (browser and Node). */
export function newBlockId(): string {
  const bytes = new Uint8Array(6)
  globalThis.crypto.getRandomValues(bytes)
  return `b_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

/** A new block of a known type with its default attributes, overridden by `attrs`. Throws for an unknown type. */
export function createBlock(
  type: string,
  attrs: Readonly<Record<string, unknown>> = {},
  children: readonly Block[] = [],
  id: string = newBlockId(),
): Block {
  const definition = getBlockDefinition(type)
  if (definition === undefined) {
    throw new Error(`unknown block type ${type}`)
  }
  return { id, type, version: definition.version, attrs: { ...defaultAttrs(definition), ...attrs }, children }
}

export function createParagraph(content: readonly InlineNode[] = []): Block {
  return createBlock(PARAGRAPH, { content })
}

/** A column with one empty paragraph, so there is somewhere to type. */
export function createColumn(): Block {
  return createBlock(COLUMN, {}, [createParagraph()])
}

/**
 * What the inserter puts in for a type: a container comes with what it needs to be valid and to have somewhere to type. Columns
 * with two columns (Gutenberg's 50/50), a list with one item, a quote and a group with a paragraph, buttons with one button.
 */
export function createInsertable(type: string): Block {
  switch (type) {
    case COLUMNS:
      return createBlock(COLUMNS, {}, [createColumn(), createColumn()])
    case LIST:
      return createBlock(LIST, {}, [createBlock(LIST_ITEM)])
    case QUOTE:
    case GROUP:
      return createBlock(type, {}, [createParagraph()])
    case BUTTONS:
      return createBlock(BUTTONS, {}, [createBlock(BUTTON)])
    default:
      return createBlock(type)
  }
}

/** True for a block whose text is its `content` rich text (paragraph, heading, list item, preformatted): the keys of text apply. */
export function isTextBlock(type: string): boolean {
  return getBlockDefinition(type)?.attributes['content']?.type === 'rich-text'
}

/** A copy of a block and everything in it with new ids: what a paste puts in, so it never meets the ids it was copied from. */
export function cloneWithNewIds(block: Block): Block {
  return { ...block, id: newBlockId(), children: block.children.map(cloneWithNewIds) }
}
