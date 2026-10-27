import { splitTagNames } from '@toascribe/shared'
import type { ContentItem, ContentTypeKey, CreateContentRequest, SettableContentStatus } from '@toascribe/shared'

// The «Innlegg» / «Side» tab of the editor's sidebar as plain data (M1.3, PLAN «Redigeringsskjermen»): what the form holds, which main
// button the screen shows, and the request a save sends. No Vue here, so the rules are tested on their own (test/editor-form.test.ts).

export type Visibility = 'public' | 'private' | 'password'

export interface EditorForm {
  title: string
  slug: string
  excerpt: string
  visibility: Visibility
  /** A new password; empty keeps the one the item has (it can be replaced, never read). */
  password: string
  /** `datetime-local` in the browser's time zone; empty is «Umiddelbart». */
  publishAt: string
  /** When a published item goes back to draft (K-064); empty for never. */
  unpublishAt: string
  authors: string[]
  sticky: boolean
  commentsOpen: boolean
  categories: string[]
  /** Tags as typed, separated by commas (WordPress' tag box). */
  tags: string
  featuredMediaId: string | null
  parentId: string | null
  menuOrder: number
  template: string | null
  seo: { title: string; description: string; image: string | null; noindex: boolean }
}

/** `datetime-local` wants the local time without a zone. */
export function toLocalInput(iso: string | null): string {
  if (iso === null) return ''
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromLocalInput(value: string): string | null {
  if (value === '') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** The form of an item, or of a new one by `authorId`. A scheduled or published item keeps its date; a draft has none («Umiddelbart»). */
export function formOf(item: ContentItem | null, authorId: string): EditorForm {
  return {
    title: item?.title ?? '',
    slug: item?.slug ?? '',
    excerpt: item?.excerpt ?? '',
    visibility: item?.visibility ?? 'public',
    password: '',
    publishAt:
      item !== null && ['publish', 'future', 'private'].includes(item.status) ? toLocalInput(item.publishedAt) : '',
    unpublishAt: toLocalInput(item?.unpublishAt ?? null),
    authors: item === null ? [authorId] : item.authors.map((author) => author.id),
    sticky: item?.sticky ?? false,
    commentsOpen: (item?.commentStatus ?? 'open') === 'open',
    categories: item?.categories.map((term) => term.id) ?? [],
    tags: item?.tags.map((term) => term.name).join(', ') ?? '',
    featuredMediaId: item?.featuredMediaId ?? null,
    parentId: item?.parentId ?? null,
    menuOrder: item?.menuOrder ?? 0,
    template: item?.template ?? null,
    seo: {
      title: item?.seo.title ?? '',
      description: item?.seo.description ?? '',
      image: item?.seo.image ?? null,
      noindex: item?.seo.noindex === true,
    },
  }
}

/**
 * The main button (WordPress' «Publiser» box): `publish` for a new or draft item, `schedule` («Planlegg») when the chosen time is in
 * the future, `update` («Oppdater») for one that is published, scheduled or private, and `submit` («Send til gjennomgang») for an
 * account that may not publish (a contributor).
 */
export type MainAction = 'publish' | 'schedule' | 'update' | 'submit'

const PUBLISHED: readonly string[] = ['publish', 'future', 'private']

export function mainAction(item: ContentItem | null, form: EditorForm, mayPublish: boolean, now: Date): MainAction {
  if (item !== null && PUBLISHED.includes(item.status)) return 'update'
  if (!mayPublish) return 'submit'
  const at = fromLocalInput(form.publishAt)
  return at !== null && new Date(at).getTime() > now.getTime() ? 'schedule' : 'publish'
}

/** Whether «Lagre utkast» is offered: for an item that is not published (a published one is updated, or moved back to draft). */
export function maySaveDraft(item: ContentItem | null): boolean {
  return item === null || !PUBLISHED.includes(item.status)
}

/** What the account may set in the sidebar, from the item's `can` (or, for a new item, its capabilities). */
export interface FormRights {
  readonly publish: boolean
  readonly editOthers: boolean
}

/**
 * The request of a save. `draft` saves without publishing (a pending item stays pending); the main action sets the status the button
 * says. Every field of the form is sent; the api changes only what differs. Authors only when the account may choose them, sticky,
 * categories and tags for a post, parent, order and template for a page.
 */
export function requestOf(
  form: EditorForm,
  options: {
    readonly type: ContentTypeKey
    readonly item: ContentItem | null
    readonly action: MainAction | 'draft'
    readonly rights: FormRights
    readonly blocks?: unknown[]
  },
): Omit<CreateContentRequest, 'type'> {
  const { item, action, rights, type } = options
  let status: SettableContentStatus
  if (action === 'draft') {
    status = item?.status === 'pending' ? 'pending' : 'draft'
  } else if (action === 'submit') {
    status = 'pending'
  } else if (form.visibility === 'private') {
    status = 'private'
  } else {
    // «publish» with a date in the future is stored as scheduled by the api.
    status = 'publish'
  }
  const request: Omit<CreateContentRequest, 'type'> = {
    title: form.title,
    slug: form.slug.trim(),
    excerpt: form.excerpt,
    status,
    publishedAt:
      action === 'draft' || action === 'submit' ? (item?.publishedAt ?? null) : fromLocalInput(form.publishAt),
    unpublishAt: fromLocalInput(form.unpublishAt),
    commentStatus: form.commentsOpen ? 'open' : 'closed',
    featuredMediaId: form.featuredMediaId,
    seo: {
      ...(form.seo.title.trim() === '' ? {} : { title: form.seo.title.trim() }),
      ...(form.seo.description.trim() === '' ? {} : { description: form.seo.description.trim() }),
      ...(form.seo.image === null ? {} : { image: form.seo.image }),
      ...(form.seo.noindex ? { noindex: true } : {}),
    },
    ...(options.blocks === undefined ? {} : { blocks: options.blocks }),
  }
  // A private item has no password; a password item gets the new one, or keeps its own; going public removes it.
  if (form.visibility === 'password' && form.password !== '') request.password = form.password
  if (form.visibility === 'public' && item?.visibility === 'password') request.password = null
  if (rights.editOthers && form.authors.length > 0) request.authors = [...form.authors]
  if (type === 'post') {
    request.categories = [...form.categories]
    request.tags = splitTagNames(form.tags)
    if (rights.editOthers && rights.publish) request.sticky = form.sticky
  } else {
    request.parentId = form.parentId
    request.menuOrder = form.menuOrder
    request.template = form.template
  }
  return request
}
