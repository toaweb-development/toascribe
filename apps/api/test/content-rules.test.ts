// The pure rules of the content service: the schedule, the slug that follows the title, the page tree and the rights.
import { DEFAULT_ROLES } from '@toascribe/shared'
import type { BuiltInRole } from '@toascribe/shared'
import { describe, expect, it } from 'vitest'

import { canDelete, canEdit, canRead } from '../src/lib/content-access.ts'
import type { AccessItem } from '../src/lib/content-access.ts'
import { flattenTree, isAutomaticSlug, resolveSchedule } from '../src/services/content.ts'

const NOW = new Date('2026-10-26T12:00:00Z')
const LATER = new Date('2026-10-27T12:00:00Z')
const EARLIER = new Date('2026-10-25T12:00:00Z')

describe('resolveSchedule', () => {
  it('gives publish and private the time of the save when they have no date', () => {
    expect(resolveSchedule('publish', null, null, NOW)).toEqual({ status: 'publish', publishedAt: NOW })
    expect(resolveSchedule('private', null, null, NOW)).toEqual({ status: 'private', publishedAt: NOW })
    expect(resolveSchedule('draft', null, null, NOW)).toEqual({ status: 'draft', publishedAt: null })
  })

  it('turns publish with a future date into future, and future with a past date into publish', () => {
    expect(resolveSchedule('publish', LATER, null, NOW)).toEqual({ status: 'future', publishedAt: LATER })
    expect(resolveSchedule('future', EARLIER, null, NOW)).toEqual({ status: 'publish', publishedAt: EARLIER })
    expect(resolveSchedule('future', LATER, null, NOW).status).toBe('future')
  })

  it('refuses future without a date, and an unpublish date that is not after the publish date', () => {
    expect(() => resolveSchedule('future', null, null, NOW)).toThrow(/publish date/)
    expect(() => resolveSchedule('publish', LATER, LATER, NOW)).toThrow(/unpublish/)
    expect(() => resolveSchedule('draft', null, EARLIER, NOW)).toThrow(/unpublish/)
    expect(resolveSchedule('publish', null, LATER, NOW).status).toBe('publish')
  })
})

describe('isAutomaticSlug', () => {
  it('knows the slug made from the title or the short id, numbered or not', () => {
    expect(isAutomaticSlug('blabaer', 'Blåbær', 7, 'nb')).toBe(true)
    expect(isAutomaticSlug('blabaer-3', 'Blåbær', 7, 'nb')).toBe(true)
    expect(isAutomaticSlug('7', '', 7, 'nb')).toBe(true)
    expect(isAutomaticSlug('7-2', '', 7, 'nb')).toBe(true)
    expect(isAutomaticSlug('valgt', 'Blåbær', 7, 'nb')).toBe(false)
    expect(isAutomaticSlug('blabaer-x', 'Blåbær', 7, 'nb')).toBe(false)
  })
})

describe('flattenTree', () => {
  it('puts children after their parent with the depth, siblings in the given order, orphans at the top', () => {
    const nodes = [
      { id: 'b', parentId: null },
      { id: 'a1', parentId: 'a' },
      { id: 'a', parentId: null },
      { id: 'a1x', parentId: 'a1' },
      { id: 'orphan', parentId: 'gone' },
      { id: 'a2', parentId: 'a' },
    ]
    expect(flattenTree(nodes)).toEqual([
      { id: 'b', depth: 0 },
      { id: 'a', depth: 0 },
      { id: 'a1', depth: 1 },
      { id: 'a1x', depth: 2 },
      { id: 'a2', depth: 1 },
      { id: 'orphan', depth: 0 },
    ])
  })

  it('shows every item of a cycle once instead of losing it', () => {
    const flat = flattenTree([
      { id: 'x', parentId: 'y' },
      { id: 'y', parentId: 'x' },
    ])
    expect(flat.map((entry) => entry.id).sort()).toEqual(['x', 'y'])
  })
})

describe('the rights of the built-in roles (map_meta_cap)', () => {
  const actor = (role: BuiltInRole) => ({
    id: 'me',
    capabilities: new Set<string>(DEFAULT_ROLES.find((entry) => entry.slug === role)?.capabilities ?? []),
  })
  const post = (
    status: AccessItem['status'],
    own: boolean,
    before: AccessItem['statusBeforeTrash'] = null,
  ): AccessItem => ({
    type: 'post',
    status,
    statusBeforeTrash: before,
    authorIds: own ? ['someone', 'me'] : ['someone'],
  })

  it('lets a contributor edit and delete its own draft, not its published post', () => {
    expect(canEdit(actor('contributor'), post('draft', true))).toBe(true)
    expect(canEdit(actor('contributor'), post('pending', true))).toBe(true)
    expect(canEdit(actor('contributor'), post('publish', true))).toBe(false)
    expect(canEdit(actor('contributor'), post('future', true))).toBe(false)
    expect(canDelete(actor('contributor'), post('publish', true))).toBe(false)
    // In the trash after being published: still the published rule.
    expect(canDelete(actor('contributor'), post('trash', true, 'publish'))).toBe(false)
    expect(canDelete(actor('contributor'), post('trash', true, 'draft'))).toBe(true)
  })

  it('lets an author handle its own published posts and read others’ published ones, nothing else of theirs', () => {
    expect(canEdit(actor('author'), post('publish', true))).toBe(true)
    expect(canEdit(actor('author'), post('draft', false))).toBe(false)
    expect(canRead(actor('author'), post('publish', false))).toBe(true)
    expect(canRead(actor('author'), post('private', false))).toBe(false)
    expect(canRead(actor('author'), post('private', true))).toBe(true)
  })

  it('keeps someone else’s trashed private post private: edit_others alone is not enough', () => {
    const othersOnly = { id: 'me', capabilities: new Set(['edit_posts', 'edit_others_posts', 'delete_others_posts']) }
    expect(canRead(othersOnly, post('trash', false, 'private'))).toBe(false)
    expect(canDelete(othersOnly, post('trash', false, 'private'))).toBe(false)
    expect(canRead(othersOnly, post('trash', false, 'draft'))).toBe(true)
    expect(canDelete(othersOnly, post('trash', false, 'publish'))).toBe(false)
  })

  it('lets an editor do everything with others’ posts and pages, a subscriber nothing', () => {
    for (const status of ['draft', 'pending', 'future', 'publish', 'private'] as const) {
      expect(canEdit(actor('editor'), post(status, false)), status).toBe(true)
      expect(canDelete(actor('editor'), { ...post(status, false), type: 'page' }), status).toBe(true)
      expect(canRead(actor('subscriber'), post(status, true)), status).toBe(false)
    }
  })
})
