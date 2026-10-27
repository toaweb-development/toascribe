import type { MenuItem } from '@toascribe/shared'
import { describe, expect, it } from 'vitest'

import {
  menuFlatten,
  menuIndent,
  menuMoveDown,
  menuMoveTo,
  menuMoveUp,
  menuOutdent,
  menuRemoveItem,
  menuUpdateItem,
} from '../app/utils/menu-tree.ts'

const node = (id: string, children: MenuItem[] = []): MenuItem => ({
  id,
  kind: 'custom',
  url: '/',
  label: id,
  newTab: false,
  cssClass: '',
  description: '',
  children,
})
/** The tree as a nested list of ids. */
const shape = (tree: readonly MenuItem[]): unknown[] =>
  tree.map((item) => (item.children.length === 0 ? item.id : [item.id, shape(item.children)]))

const TREE = [node('m_a', [node('m_a1'), node('m_a2')]), node('m_b'), node('m_c')]

describe("the menu editor's tree (K-132)", () => {
  it('moves an item up and down among its siblings, and not past the ends', () => {
    expect(shape(menuMoveDown(TREE, 'm_a1'))).toEqual([['m_a', ['m_a2', 'm_a1']], 'm_b', 'm_c'])
    expect(shape(menuMoveUp(TREE, 'm_c'))).toEqual([['m_a', ['m_a1', 'm_a2']], 'm_c', 'm_b'])
    expect(shape(menuMoveUp(TREE, 'm_a'))).toEqual(shape(TREE))
    expect(shape(menuMoveDown(TREE, 'm_c'))).toEqual(shape(TREE))
  })

  it('moves an item in under the one above it, and out after its parent: three levels', () => {
    const deeper = menuIndent(menuIndent(TREE, 'm_b'), 'm_c')
    expect(shape(deeper)).toEqual([['m_a', ['m_a1', 'm_a2', 'm_b', 'm_c']]])
    const third = menuIndent(deeper, 'm_c')
    expect(shape(third)).toEqual([['m_a', ['m_a1', 'm_a2', ['m_b', ['m_c']]]]])
    expect(menuFlatten(third).map((entry) => entry.depth)).toEqual([0, 1, 1, 1, 2])
    expect(shape(menuOutdent(third, 'm_c'))).toEqual([['m_a', ['m_a1', 'm_a2', 'm_b', 'm_c']]])
    expect(shape(menuOutdent(TREE, 'm_a1'))).toEqual([['m_a', ['m_a2']], 'm_a1', 'm_b', 'm_c'])
    expect(shape(menuIndent(TREE, 'm_a'))).toEqual(shape(TREE))
  })

  it('drops an item before, after or inside another, never into itself', () => {
    expect(shape(menuMoveTo(TREE, 'm_c', 'm_a1', 'before'))).toEqual([['m_a', ['m_c', 'm_a1', 'm_a2']], 'm_b'])
    expect(shape(menuMoveTo(TREE, 'm_a2', 'm_c', 'after'))).toEqual([['m_a', ['m_a1']], 'm_b', 'm_c', 'm_a2'])
    expect(shape(menuMoveTo(TREE, 'm_c', 'm_b', 'inside'))).toEqual([
      ['m_a', ['m_a1', 'm_a2']],
      ['m_b', ['m_c']],
    ])
    expect(shape(menuMoveTo(TREE, 'm_a', 'm_a2', 'inside'))).toEqual(shape(TREE))
  })

  it('changes fields and takes an item out with its children', () => {
    expect(menuUpdateItem(TREE, 'm_a2', { label: 'Ny' })[0]?.children[1]?.label).toBe('Ny')
    expect(shape(menuRemoveItem(TREE, 'm_a'))).toEqual(['m_b', 'm_c'])
  })
})
