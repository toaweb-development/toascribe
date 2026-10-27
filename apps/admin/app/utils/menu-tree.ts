// The operations of «Utseende → Menyer» on a menu's tree (M1.5, K-132): move an item up, down, in under the item above it, or out to
// its parent's level, drop it before, after or inside another, change its fields, take it out. Each returns a new tree; an operation
// that cannot be done (the first item up, an item into itself) returns the tree as it was.
import type { MenuItem } from '@toascribe/shared'

type Tree = readonly MenuItem[]

/** Where an item stands: its parent's list (by the path of indexes to it) and its index there. */
interface Place {
  readonly path: readonly number[]
  readonly index: number
}

function find(tree: Tree, id: string, path: number[] = []): Place | undefined {
  for (const [index, item] of tree.entries()) {
    if (item.id === id) return { path, index }
    const below = find(item.children, id, [...path, index])
    if (below !== undefined) return below
  }
  return undefined
}

function listAt(tree: Tree, path: readonly number[]): Tree {
  return path.reduce<Tree>((list, index) => list[index]?.children ?? [], tree)
}

/** The tree with the list at `path` replaced. */
function withList(tree: Tree, path: readonly number[], list: Tree): MenuItem[] {
  if (path.length === 0) return [...list]
  const [first, ...rest] = path
  return tree.map((item, index) =>
    index === first ? { ...item, children: withList(item.children, rest, list) } : item,
  )
}

export function menuFindItem(tree: Tree, id: string): MenuItem | undefined {
  const place = find(tree, id)
  return place === undefined ? undefined : listAt(tree, place.path)[place.index]
}

/** The item and everything below it. */
function contains(item: MenuItem, id: string): boolean {
  return item.id === id || item.children.some((child) => contains(child, id))
}

export function menuRemoveItem(tree: Tree, id: string): MenuItem[] {
  const place = find(tree, id)
  if (place === undefined) return [...tree]
  const list = listAt(tree, place.path).filter((_, index) => index !== place.index)
  return withList(tree, place.path, list)
}

export function menuUpdateItem(tree: Tree, id: string, fields: Partial<Omit<MenuItem, 'id' | 'children'>>): MenuItem[] {
  const place = find(tree, id)
  if (place === undefined) return [...tree]
  const list = listAt(tree, place.path).map((item, index) => (index === place.index ? { ...item, ...fields } : item))
  return withList(tree, place.path, list)
}

export function menuMoveUp(tree: Tree, id: string): MenuItem[] {
  const place = find(tree, id)
  if (place === undefined || place.index === 0) return [...tree]
  const list = [...listAt(tree, place.path)]
  const [item] = list.splice(place.index, 1)
  if (item === undefined) return [...tree]
  list.splice(place.index - 1, 0, item)
  return withList(tree, place.path, list)
}

export function menuMoveDown(tree: Tree, id: string): MenuItem[] {
  const place = find(tree, id)
  if (place === undefined) return [...tree]
  const list = [...listAt(tree, place.path)]
  if (place.index >= list.length - 1) return [...tree]
  const [item] = list.splice(place.index, 1)
  if (item === undefined) return [...tree]
  list.splice(place.index + 1, 0, item)
  return withList(tree, place.path, list)
}

/** In under the item above it, as its last child (WordPress' «Under …»). */
export function menuIndent(tree: Tree, id: string): MenuItem[] {
  const place = find(tree, id)
  if (place === undefined || place.index === 0) return [...tree]
  const list = [...listAt(tree, place.path)]
  const item = list[place.index]
  const above = list[place.index - 1]
  if (item === undefined || above === undefined) return [...tree]
  list.splice(place.index, 1)
  list[place.index - 1] = { ...above, children: [...above.children, item] }
  return withList(tree, place.path, list)
}

/** Out to its parent's level, right after the parent. */
export function menuOutdent(tree: Tree, id: string): MenuItem[] {
  const place = find(tree, id)
  if (place === undefined || place.path.length === 0) return [...tree]
  const item = listAt(tree, place.path)[place.index]
  if (item === undefined) return [...tree]
  const parentPath = place.path.slice(0, -1)
  const parentIndex = place.path.at(-1) ?? 0
  const without = menuRemoveItem(tree, id)
  const outer = [...listAt(without, parentPath)]
  outer.splice(parentIndex + 1, 0, item)
  return withList(without, parentPath, outer)
}

export type MenuDropPosition = 'before' | 'after' | 'inside'

/** Drag and drop: the item before, after or inside (as the first child of) the target. Never into itself or below itself. */
export function menuMoveTo(tree: Tree, id: string, targetId: string, position: MenuDropPosition): MenuItem[] {
  const item = menuFindItem(tree, id)
  if (item === undefined || contains(item, targetId)) return [...tree]
  const without = menuRemoveItem(tree, id)
  const target = find(without, targetId)
  if (target === undefined) return [...tree]
  if (position === 'inside') {
    const targetItem = listAt(without, target.path)[target.index]
    if (targetItem === undefined) return [...tree]
    return withList(
      without,
      target.path,
      listAt(without, target.path).map((entry, index) =>
        index === target.index ? { ...entry, children: [item, ...entry.children] } : entry,
      ),
    )
  }
  const list = [...listAt(without, target.path)]
  list.splice(position === 'before' ? target.index : target.index + 1, 0, item)
  return withList(without, target.path, list)
}

/** The tree as a flat list in reading order, with each item's depth and its place among its siblings (for drawing and for labels). */
export function menuFlatten(
  tree: Tree,
  depth = 0,
): { item: MenuItem; depth: number; first: boolean; last: boolean; parentId: string | null }[] {
  const walk = (list: Tree, level: number, parentId: string | null): ReturnType<typeof menuFlatten> =>
    list.flatMap((item, index) => [
      { item, depth: level, first: index === 0, last: index === list.length - 1, parentId },
      ...walk(item.children, level + 1, item.id),
    ])
  return walk(tree, depth, null)
}

/** A new item id (`m_` and 12 hex characters). */
export function newMenuItemId(): string {
  const bytes = new Uint8Array(6)
  globalThis.crypto.getRandomValues(bytes)
  return `m_${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
