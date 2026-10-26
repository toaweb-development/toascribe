import type { ContentListItem } from '@toascribe/shared'
import { describe, expect, it } from 'vitest'

import { depthPrefix, describeBulk, itemStates, monthLabel, shownDate, titleOf } from '../app/utils/content-text.ts'

const t = (key: string, named?: Record<string, string | number>) =>
  named === undefined ? key : `${key}(${Object.values(named).join(',')})`

const ITEM: ContentListItem = {
  id: '01a15f9a-26a2-73d3-8aad-c6b671836b33',
  shortId: 1,
  shortLink: '/?p=1',
  type: 'post',
  locale: 'nb',
  title: 'Hei',
  slug: 'hei',
  status: 'draft',
  statusBeforeTrash: null,
  visibility: 'password',
  sticky: true,
  commentStatus: 'open',
  parentId: null,
  menuOrder: 0,
  template: null,
  publishedAt: '2026-10-20T10:00:00.000Z',
  unpublishAt: null,
  createdAt: '2026-10-19T10:00:00.000Z',
  modifiedAt: '2026-10-21T10:00:00.000Z',
  authors: [],
  can: { edit: true, delete: true, publish: true, editOthers: true },
  depth: 0,
}

describe('the content list words', () => {
  it('names the states after a title, without the view’s own status', () => {
    expect(itemStates(t, ITEM, 'all')).toEqual([
      'content.states.draft',
      'content.states.password',
      'content.states.sticky',
    ])
    expect(itemStates(t, ITEM, 'draft')).toEqual(['content.states.password', 'content.states.sticky'])
  })

  it('shows the publish date of published items and the last change of the rest', () => {
    expect(shownDate(ITEM)).toBe(ITEM.modifiedAt)
    expect(shownDate({ ...ITEM, status: 'publish' })).toBe(ITEM.publishedAt)
  })

  it('marks child pages and untitled items as WordPress does', () => {
    expect(depthPrefix(2)).toBe('— — ')
    expect(titleOf(t, '  ')).toBe('content.noTitle')
    expect(monthLabel('2026-10', 'nb')).toBe('oktober 2026')
  })

  it('sums up a bulk action with what was left alone', () => {
    const done = describeBulk(t, 'trash', {
      changed: [ITEM.id],
      unchanged: [],
      skipped: [
        { id: 'a', reason: 'forbidden' },
        { id: 'b', reason: 'not_found' },
      ],
    })
    expect(done.tone).toBe('warning')
    expect(done.details).toEqual(['content.bulkSkipped.forbidden(2)'])
    expect(describeBulk(t, 'delete', { changed: [ITEM.id], unchanged: [], skipped: [] }).tone).toBe('success')
  })
})
