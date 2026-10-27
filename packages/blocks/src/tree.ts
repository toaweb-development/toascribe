// Operations on a block document. Every operation is a pure function: it takes a document and returns a new one, sharing every
// block that did not change, or `undefined` when the change is not allowed (the block is not there, the place does not take that
// block, a parent would get too few or too many children). The editor's model calls these and records the result in its history;
// nothing here knows about Vue, TipTap or the history.
import type { Block, BlockDocument } from './block.ts'
import { createBlock, createParagraph, isTextBlock } from './block.ts'
import type { InlineNode } from './inline.ts'
import { inlineLength, joinInline } from './inline.ts'
import { HEADING, LIST, LIST_ITEM, PARAGRAPH, PREFORMATTED, canContain, getBlockDefinition } from './registry.ts'

/** A place in a document: the parent block (`null` for the top level) and an index in its children. */
export interface Place {
  readonly parentId: string | null
  readonly index: number
}

/** Where a block stands: its place, and its parent's type (`null` at the top level). */
export interface Located extends Place {
  readonly block: Block
  readonly parentType: string | null
}

export type Direction = 'up' | 'down'

export function findBlock(document: BlockDocument, id: string): Block | undefined {
  return locate(document, id)?.block
}

export function locate(document: BlockDocument, id: string): Located | undefined {
  const search = (list: readonly Block[], parent: Block | null): Located | undefined => {
    for (const [index, block] of list.entries()) {
      if (block.id === id) {
        return { block, index, parentId: parent?.id ?? null, parentType: parent?.type ?? null }
      }
      const found = search(block.children, block)
      if (found !== undefined) {
        return found
      }
    }
    return undefined
  }
  return search(document, null)
}

/** The children of a block, or the top level for `null`. Undefined when there is no such block. */
export function childrenOf(document: BlockDocument, parentId: string | null): readonly Block[] | undefined {
  return parentId === null ? document : findBlock(document, parentId)?.children
}

/** Every block in document order (a parent before its children), for focus order and counts. */
export function flatten(document: BlockDocument): Block[] {
  return document.flatMap((block) => [block, ...flatten(block.children)])
}

/** Replaces one block (found by id, anywhere) with what `change` makes of it. */
function replaceBlock(document: BlockDocument, id: string, change: (block: Block) => Block): BlockDocument | undefined {
  const inList = (list: readonly Block[]): readonly Block[] | undefined => {
    for (const [index, block] of list.entries()) {
      const replaced = block.id === id ? change(block) : withChildren(block, inList(block.children))
      if (replaced !== undefined) {
        const copy = list.slice()
        copy[index] = replaced
        return copy
      }
    }
    return undefined
  }
  return inList(document)
}

function withChildren(block: Block, children: readonly Block[] | undefined): Block | undefined {
  return children === undefined ? undefined : { ...block, children }
}

/** Replaces the children of a parent (`null`: the top level). */
function replaceChildren(
  document: BlockDocument,
  parentId: string | null,
  change: (children: readonly Block[]) => readonly Block[],
): BlockDocument | undefined {
  if (parentId === null) {
    return change(document)
  }
  return replaceBlock(document, parentId, (parent) => ({ ...parent, children: change(parent.children) }))
}

function countFits(type: string | null, count: number): boolean {
  if (type === null) {
    return true
  }
  const limits = getBlockDefinition(type)?.childCount
  return limits === undefined || (count >= limits.min && count <= limits.max)
}

/** Puts a block at a place, if the parent takes it and does not get too many children. */
export function insertBlock(document: BlockDocument, place: Place, block: Block): BlockDocument | undefined {
  const parentType = place.parentId === null ? null : (findBlock(document, place.parentId)?.type ?? undefined)
  const siblings = childrenOf(document, place.parentId)
  if (parentType === undefined || siblings === undefined || !canContain(parentType, block.type)) {
    return undefined
  }
  if (place.index < 0 || place.index > siblings.length || !countFits(parentType, siblings.length + 1)) {
    return undefined
  }
  return replaceChildren(document, place.parentId, (children) => [
    ...children.slice(0, place.index),
    block,
    ...children.slice(place.index),
  ])
}

/** Removes a block and everything in it, unless its parent would have too few children (a columns block keeps two). */
export function removeBlock(document: BlockDocument, id: string): BlockDocument | undefined {
  const located = locate(document, id)
  if (located === undefined) {
    return undefined
  }
  const siblings = childrenOf(document, located.parentId) ?? []
  if (!countFits(located.parentType, siblings.length - 1)) {
    return undefined
  }
  return replaceChildren(document, located.parentId, (children) => children.filter((child) => child.id !== id))
}

/** Sets some attributes of a block. The values are not checked here: the editor's model validates before it saves. */
export function updateAttrs(
  document: BlockDocument,
  id: string,
  attrs: Readonly<Record<string, unknown>>,
): BlockDocument | undefined {
  return replaceBlock(document, id, (block) => ({ ...block, attrs: { ...block.attrs, ...attrs } }))
}

/**
 * Moves a block to a place. The index is read in the target's children after the block has been taken out (so moving a block
 * one step down in its own list is `index + 1`). Refused when the target does not take the block, when the target is the block
 * itself or inside it, or when a parent would end up with too few or too many children.
 */
export function moveBlockTo(document: BlockDocument, id: string, place: Place): BlockDocument | undefined {
  const located = locate(document, id)
  if (located === undefined) {
    return undefined
  }
  if (
    place.parentId !== null &&
    (place.parentId === id || findBlock(located.block.children, place.parentId) !== undefined)
  ) {
    return undefined
  }
  if (located.parentId === place.parentId && located.index === place.index) {
    return undefined
  }
  const without = replaceChildren(document, located.parentId, (children) => children.filter((child) => child.id !== id))
  if (without === undefined) {
    return undefined
  }
  const sourceCount = (childrenOf(without, located.parentId) ?? []).length
  const moved = insertBlock(without, place, located.block)
  if (moved === undefined) {
    return undefined
  }
  // Leaving a parent may not take it below its minimum (moving within the same parent keeps the count).
  return located.parentId === place.parentId || countFits(located.parentType, sourceCount) ? moved : undefined
}

/**
 * The block inside `node` that a block of type `type` enters when it moves into `node` from above (`down`: the first
 * container, at its start) or from below (`up`: the last, at its end): `node` itself if it takes the type, else the nearest
 * container along its first or last children. Undefined when it takes the type nowhere.
 */
function entryInto(node: Block, type: string, direction: Direction): Block | undefined {
  if (canContain(node.type, type)) {
    return node
  }
  const child = direction === 'up' ? node.children.at(-1) : node.children[0]
  return child === undefined ? undefined : entryInto(child, type, direction)
}

/**
 * Where «move up» or «move down» takes a block, as in Gutenberg but across containers:
 * 1. Past its neighbour in the same list, or into the neighbour when the neighbour is (or holds) a container that takes the
 *    block: a paragraph above a columns block moves down into the start of the first column.
 * 2. At the edge of its list: into the parent's neighbour in that direction when it takes the block (from the end of one column
 *    to the start of the next), else out, to just before or after the nearest ancestor whose parent takes it (out of the
 *    columns block).
 * Undefined at the top or the bottom of the document, and for a block that has nowhere to go (a column moves only among its
 * columns).
 */
export function moveTarget(document: BlockDocument, id: string, direction: Direction): Place | undefined {
  const located = locate(document, id)
  if (located === undefined) {
    return undefined
  }
  const { block } = located
  const step = direction === 'up' ? -1 : 1
  const siblings = childrenOf(document, located.parentId) ?? []
  const neighbour = siblings[located.index + step]
  if (neighbour !== undefined) {
    const entry = entryInto(neighbour, block.type, direction)
    if (entry !== undefined) {
      return { parentId: entry.id, index: direction === 'up' ? entry.children.length : 0 }
    }
    return { parentId: located.parentId, index: located.index + step }
  }
  if (located.parentId === null) {
    return undefined
  }
  const parent = locate(document, located.parentId)
  if (parent === undefined) {
    return undefined
  }
  const parentNeighbour = (childrenOf(document, parent.parentId) ?? [])[parent.index + step]
  if (parentNeighbour !== undefined) {
    const entry = entryInto(parentNeighbour, block.type, direction)
    if (entry !== undefined) {
      return { parentId: entry.id, index: direction === 'up' ? entry.children.length : 0 }
    }
  }
  for (let ancestor: Located | undefined = parent; ancestor !== undefined;) {
    if (canContain(ancestor.parentType, block.type)) {
      return { parentId: ancestor.parentId, index: direction === 'up' ? ancestor.index : ancestor.index + 1 }
    }
    ancestor = ancestor.parentId === null ? undefined : locate(document, ancestor.parentId)
  }
  return undefined
}

/** «Move up» / «move down» (moveTarget), or undefined when the block cannot move that way. */
export function moveBlock(document: BlockDocument, id: string, direction: Direction): BlockDocument | undefined {
  const place = moveTarget(document, id, direction)
  return place === undefined ? undefined : moveBlockTo(document, id, place)
}

/**
 * The type of the block that Enter makes after a text block: another list item in a list, a paragraph after a paragraph or a
 * heading (as in Gutenberg). Undefined for a block where Enter is a line break (preformatted).
 */
export function splitType(type: string): string | undefined {
  if (type === LIST_ITEM) return LIST_ITEM
  if (type === PREFORMATTED || !isTextBlock(type)) return undefined
  return PARAGRAPH
}

/**
 * Enter inside a text block: the block keeps the content before the cursor, and a new block (splitType) with the content after it
 * is put right after it. Returns the document and the new block's id.
 */
export function splitText(
  document: BlockDocument,
  id: string,
  before: readonly InlineNode[],
  after: readonly InlineNode[],
  newId?: string,
): { document: BlockDocument; newId: string } | undefined {
  const located = locate(document, id)
  const type = located === undefined ? undefined : splitType(located.block.type)
  if (located === undefined || type === undefined) {
    return undefined
  }
  const newBlock = createBlock(type, { content: after }, [], newId)
  const updated = updateAttrs(document, id, { content: before })
  const inserted =
    updated === undefined
      ? undefined
      : insertBlock(updated, { parentId: located.parentId, index: located.index + 1 }, newBlock)
  return inserted === undefined ? undefined : { document: inserted, newId: newBlock.id }
}

/** Enter inside a paragraph (the prototype's name for splitText). */
export function splitParagraph(
  document: BlockDocument,
  id: string,
  before: readonly InlineNode[],
  after: readonly InlineNode[],
  newBlock: Block = createParagraph(after),
): { document: BlockDocument; newId: string } | undefined {
  return locate(document, id)?.block.type === PARAGRAPH
    ? splitText(document, id, before, after, newBlock.id)
    : undefined
}

/** Two text blocks whose text may join: paragraphs and headings with each other, list items with each other. */
function mergeable(previous: string, current: string): boolean {
  const flowing = [PARAGRAPH, HEADING]
  return (flowing.includes(previous) && flowing.includes(current)) || (previous === LIST_ITEM && current === LIST_ITEM)
}

/**
 * Backspace at the start of a text block whose previous sibling is a text block it may join (mergeable): the two become one, and
 * the cursor goes to where they meet. A list item with a nested list is not joined (its list would have nowhere to go).
 */
export function mergeWithPrevious(
  document: BlockDocument,
  id: string,
): { document: BlockDocument; targetId: string; offset: number } | undefined {
  const located = locate(document, id)
  const previous = located === undefined ? undefined : childrenOf(document, located.parentId)?.[located.index - 1]
  if (
    located === undefined ||
    previous === undefined ||
    !mergeable(previous.type, located.block.type) ||
    located.block.children.length > 0
  ) {
    return undefined
  }
  const previousContent = contentOf(previous)
  const joined = joinInline(previousContent, contentOf(located.block))
  const updated = updateAttrs(document, previous.id, { content: joined })
  const removed = updated === undefined ? undefined : removeBlock(updated, id)
  return removed === undefined
    ? undefined
    : { document: removed, targetId: previous.id, offset: inlineLength(previousContent) }
}

/**
 * Tab in a list item: it moves into a list under the item before it (the end of that item's nested list, or a new one of the same
 * kind). Undefined for the first item of a list.
 */
export function indentListItem(document: BlockDocument, id: string): BlockDocument | undefined {
  const located = locate(document, id)
  if (located?.block.type !== LIST_ITEM || located.parentId === null) {
    return undefined
  }
  const previous = childrenOf(document, located.parentId)?.[located.index - 1]
  if (previous === undefined) {
    return undefined
  }
  const nested = previous.children[0]
  if (nested !== undefined) {
    return moveBlockTo(document, id, { parentId: nested.id, index: nested.children.length })
  }
  const list = findBlock(document, located.parentId)
  const without = removeBlock(document, id)
  if (without === undefined || list === undefined) {
    return undefined
  }
  const newList = createBlock(LIST, { ordered: list.attrs['ordered'] === true }, [located.block])
  return insertBlock(without, { parentId: previous.id, index: 0 }, newList)
}

/**
 * Shift+Tab in a nested list item: it moves out, to just after the item whose list it is in. When it was the only item, that list
 * goes too. Undefined at the top level of a list (there is nowhere further out to go inside the list).
 */
export function outdentListItem(document: BlockDocument, id: string): BlockDocument | undefined {
  const located = locate(document, id)
  if (located?.block.type !== LIST_ITEM || located.parentId === null) {
    return undefined
  }
  const list = locate(document, located.parentId)
  if (list === undefined || list.parentId === null || list.parentType !== LIST_ITEM) {
    return undefined
  }
  const owner = locate(document, list.parentId)
  if (owner === undefined || owner.parentId === null) {
    return undefined
  }
  const target = { parentId: owner.parentId, index: owner.index + 1 }
  if (list.block.children.length > 1) {
    return moveBlockTo(document, id, target)
  }
  // The only item: the nested list goes, and the item takes its place after its owner.
  const without = replaceBlock(document, owner.block.id, (block) => ({ ...block, children: [] }))
  return without === undefined ? undefined : insertBlock(without, target, located.block)
}

/**
 * Enter in an empty last item of a top-level list (Gutenberg): the item goes and a paragraph takes the cursor right after the list.
 * When it was the only item, the list goes too. Undefined for an item that is not empty, not last, or in a nested list (that one is
 * outdented instead).
 */
export function endList(
  document: BlockDocument,
  itemId: string,
  paragraph: Block = createParagraph(),
): { document: BlockDocument; newId: string } | undefined {
  const located = locate(document, itemId)
  if (located?.block.type !== LIST_ITEM || located.parentId === null || contentOf(located.block).length > 0) {
    return undefined
  }
  const list = locate(document, located.parentId)
  if (list === undefined || list.parentType === LIST_ITEM || located.index !== list.block.children.length - 1) {
    return undefined
  }
  const without =
    list.block.children.length === 1 ? removeBlock(document, list.block.id) : removeBlock(document, itemId)
  const index = list.block.children.length === 1 ? list.index : list.index + 1
  const next = without === undefined ? undefined : insertBlock(without, { parentId: list.parentId, index }, paragraph)
  return next === undefined ? undefined : { document: next, newId: paragraph.id }
}

/** The blocks between two siblings, both included, in document order; undefined when they are not siblings. */
export function siblingRange(document: BlockDocument, a: string, b: string): string[] | undefined {
  const first = locate(document, a)
  const second = locate(document, b)
  if (first === undefined || second?.parentId !== first.parentId) {
    return undefined
  }
  const siblings = childrenOf(document, first.parentId) ?? []
  const [from, to] = first.index <= second.index ? [first.index, second.index] : [second.index, first.index]
  return siblings.slice(from, to + 1).map((block) => block.id)
}

/**
 * The two blocks to select between when a selection runs from `a` to `b` in different parents (Shift+click across a column, as
 * Gutenberg does): the ancestors of each that are siblings under their nearest common parent. Undefined when one is inside the other.
 */
export function selectionEnds(document: BlockDocument, a: string, b: string): [string, string] | undefined {
  const chain = (id: string): string[] => {
    const ids: string[] = []
    for (
      let at = locate(document, id);
      at !== undefined;
      at = at.parentId === null ? undefined : locate(document, at.parentId)
    ) {
      ids.unshift(at.block.id)
    }
    return ids
  }
  const first = chain(a)
  const second = chain(b)
  if (first.length === 0 || second.length === 0) return undefined
  let depth = 0
  while (depth < first.length && depth < second.length && first[depth] === second[depth]) depth += 1
  const left = first[depth]
  const right = second[depth]
  return left === undefined || right === undefined ? undefined : [left, right]
}

/** Removes several blocks in one change; undefined when one of them may not go. A block inside another one removed goes with it. */
export function removeBlocks(document: BlockDocument, ids: readonly string[]): BlockDocument | undefined {
  let next: BlockDocument | undefined = document
  for (const id of ids) {
    if (next === undefined) return undefined
    if (findBlock(next, id) === undefined) continue
    next = removeBlock(next, id)
  }
  return next
}

/** Puts several blocks at a place, in order, in one change; undefined when the place does not take one of them. */
export function insertBlocks(
  document: BlockDocument,
  place: Place,
  blocks: readonly Block[],
): BlockDocument | undefined {
  let next: BlockDocument | undefined = document
  blocks.forEach((block, offset) => {
    next =
      next === undefined
        ? undefined
        : insertBlock(next, { parentId: place.parentId, index: place.index + offset }, block)
  })
  return next
}

/** The inline content of a text block (`[]` for anything else). */
export function contentOf(block: Block): readonly InlineNode[] {
  const content = block.attrs['content']
  return Array.isArray(content) ? (content as InlineNode[]) : []
}
