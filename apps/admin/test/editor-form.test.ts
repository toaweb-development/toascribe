// The sidebar's rules (M1.3): the main button for each state («Publiser», «Planlegg», «Oppdater», «Send til gjennomgang»), and the
// request each save sends (a contributor never sends a publishing status; a future time schedules; private and password visibility).
import { describe, expect, it } from 'vitest'

import type { ContentItem } from '@toascribe/shared'

import { formOf, mainAction, maySaveDraft, requestOf } from '../app/utils/editor-form.ts'

const NOW = new Date('2026-10-27T12:00:00Z')
const AUTHOR = '0198a3c2-0000-7000-8000-000000000001'

function item(changes: Partial<ContentItem>): ContentItem {
  return {
    id: '0198a3c2-0000-7000-8000-0000000000aa',
    shortId: 7,
    shortLink: '/?p=7',
    type: 'post',
    locale: 'nb',
    title: 'Tittel',
    slug: 'tittel',
    status: 'draft',
    statusBeforeTrash: null,
    visibility: 'public',
    sticky: false,
    commentStatus: 'open',
    parentId: null,
    menuOrder: 0,
    template: null,
    publishedAt: null,
    unpublishAt: null,
    createdAt: NOW.toISOString(),
    modifiedAt: NOW.toISOString(),
    authors: [{ id: AUTHOR, username: 'a', displayName: 'A' }],
    categories: [],
    tags: [{ id: '0198a3c2-0000-7000-8000-0000000000bb', name: 'tur', slug: 'tur' }],
    can: { edit: true, delete: true, publish: true, editOthers: false },
    excerpt: '',
    blocks: [],
    blocksFormat: 'blocks',
    featuredMediaId: null,
    seo: {},
    media: [],
    ...changes,
  } as ContentItem
}

const rights = { publish: true, editOthers: false }

describe('the main button', () => {
  it('publishes a new item now, schedules one with a time ahead, updates a published one', () => {
    const form = formOf(null, AUTHOR)
    expect(mainAction(null, form, true, NOW)).toBe('publish')
    expect(mainAction(null, { ...form, publishAt: '2026-10-27T13:05' }, true, NOW)).toBe('schedule')
    expect(mainAction(item({ status: 'publish' }), form, true, NOW)).toBe('update')
    expect(mainAction(item({ status: 'future' }), form, true, NOW)).toBe('update')
  })

  it('is «Send til gjennomgang» for an account that may not publish', () => {
    expect(mainAction(item({}), formOf(item({}), AUTHOR), false, NOW)).toBe('submit')
  })

  it('offers «Lagre utkast» only while the item is not published', () => {
    expect(maySaveDraft(null)).toBe(true)
    expect(maySaveDraft(item({ status: 'pending' }))).toBe(true)
    expect(maySaveDraft(item({ status: 'future' }))).toBe(false)
  })
})

describe('the request of a save', () => {
  it('a contributor sends pending and never a time of its own', () => {
    const form = { ...formOf(item({}), AUTHOR), publishAt: '2030-01-01T10:00' }
    const request = requestOf(form, {
      type: 'post',
      item: item({}),
      action: 'submit',
      rights: { publish: false, editOthers: false },
    })
    expect(request.status).toBe('pending')
    expect(request.publishedAt).toBeNull()
    expect(request).not.toHaveProperty('sticky')
    expect(request).not.toHaveProperty('authors')
  })

  it('schedules with the chosen time, and keeps a pending item pending on «Lagre utkast»', () => {
    const form = { ...formOf(null, AUTHOR), publishAt: '2026-10-27T13:05' }
    const scheduled = requestOf(form, { type: 'post', item: null, action: 'schedule', rights })
    expect(scheduled.status).toBe('publish')
    expect(scheduled.publishedAt).toBe(new Date('2026-10-27T13:05').toISOString())
    expect(requestOf(form, { type: 'post', item: item({ status: 'pending' }), action: 'draft', rights }).status).toBe(
      'pending',
    )
  })

  it('sends private as a status, a new password when one is typed, and removes it when going public', () => {
    const form = formOf(item({}), AUTHOR)
    expect(
      requestOf({ ...form, visibility: 'private' }, { type: 'post', item: null, action: 'publish', rights }).status,
    ).toBe('private')
    const withPassword = requestOf(
      { ...form, visibility: 'password', password: 'hemmelig' },
      {
        type: 'post',
        item: null,
        action: 'publish',
        rights,
      },
    )
    expect(withPassword.password).toBe('hemmelig')
    const kept = requestOf(
      { ...form, visibility: 'password' },
      { type: 'post', item: item({ visibility: 'password' }), action: 'update', rights },
    )
    expect(kept).not.toHaveProperty('password')
    const removed = requestOf(form, { type: 'post', item: item({ visibility: 'password' }), action: 'update', rights })
    expect(removed.password).toBeNull()
  })

  it('sends the post fields for a post and the page fields for a page, and an SEO panel without empty fields', () => {
    const form = { ...formOf(item({}), AUTHOR), seo: { title: '  ', description: 'Kort', image: null, noindex: false } }
    const post = requestOf(form, { type: 'post', item: item({}), action: 'draft', rights })
    expect(post.tags).toEqual(['tur'])
    expect(post).not.toHaveProperty('parentId')
    expect(post.seo).toEqual({ description: 'Kort' })
    const page = requestOf(form, { type: 'page', item: item({ type: 'page' }), action: 'draft', rights })
    expect(page).toMatchObject({ parentId: null, menuOrder: 0, template: null })
    expect(page).not.toHaveProperty('categories')
  })
})
