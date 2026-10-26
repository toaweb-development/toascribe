import type { ContentBulkResponse, ContentListItem, ContentListStatus, ContentTypeKey } from '@toascribe/shared'

import type { MessageT } from './users-messages.ts'

// The words of the content lists and the editor that depend on data: the type (posts or pages), a status, the date column, the
// states after a title and the answers to an action. Every message is asked for with a literal key, so the root test
// (test/i18n-strings.test.ts) sees that it is in use. The words are those of WordPress' Norwegian (bokmål) translation.

/** The type's own words: «Innlegg» or «Sider», and the phrases that differ between them. */
export function typeText(t: MessageT, type: ContentTypeKey) {
  return type === 'page'
    ? {
        title: t('content.pages.title'),
        add: t('content.pages.add'),
        addTitle: t('content.pages.addTitle'),
        edit: t('content.pages.edit'),
        search: t('content.pages.search'),
        caption: t('content.pages.caption'),
        views: t('content.pages.views'),
        empty: t('content.pages.empty'),
        emptyTrash: t('content.pages.emptyTrash'),
        denied: t('content.pages.denied'),
      }
    : {
        title: t('content.posts.title'),
        add: t('content.posts.add'),
        addTitle: t('content.posts.addTitle'),
        edit: t('content.posts.edit'),
        search: t('content.posts.search'),
        caption: t('content.posts.caption'),
        views: t('content.posts.views'),
        empty: t('content.posts.empty'),
        emptyTrash: t('content.posts.emptyTrash'),
        denied: t('content.posts.denied'),
      }
}

/** The name of a view above the list. */
export function viewLabel(t: MessageT, status: ContentListStatus | 'mine'): string {
  switch (status) {
    case 'all':
      return t('content.views.all')
    case 'mine':
      return t('content.views.mine')
    case 'publish':
      return t('content.views.publish')
    case 'draft':
      return t('content.views.draft')
    case 'pending':
      return t('content.views.pending')
    case 'future':
      return t('content.views.future')
    case 'private':
      return t('content.views.private')
    case 'trash':
      return t('content.views.trash')
    default:
      return status satisfies never
  }
}

/** The status as the quick edit's select and the editor name it. */
export function statusLabel(t: MessageT, status: 'draft' | 'pending' | 'future' | 'publish' | 'private'): string {
  switch (status) {
    case 'draft':
      return t('content.status.draft')
    case 'pending':
      return t('content.status.pending')
    case 'future':
      return t('content.status.future')
    case 'publish':
      return t('content.status.publish')
    case 'private':
      return t('content.status.private')
    default:
      return status satisfies never
  }
}

/** WordPress' «post states» after the title: «— Utkast», «— Passordbeskyttet», «— Festet». The view's own status is left out. */
export function itemStates(t: MessageT, item: ContentListItem, view: ContentListStatus): string[] {
  const states: string[] = []
  if (item.status !== view) {
    if (item.status === 'draft') states.push(t('content.states.draft'))
    if (item.status === 'pending') states.push(t('content.states.pending'))
    if (item.status === 'future') states.push(t('content.states.future'))
    if (item.status === 'private') states.push(t('content.states.private'))
  }
  if (item.visibility === 'password') states.push(t('content.states.password'))
  if (item.sticky) states.push(t('content.states.sticky'))
  return states
}

/** What the date column says before the date: «Publisert», «Planlagt», or «Sist endret» for the rest. */
export function dateLabel(t: MessageT, item: ContentListItem): string {
  if (item.status === 'publish' || (item.status === 'trash' && item.statusBeforeTrash === 'publish')) {
    return t('content.date.published')
  }
  if (item.status === 'future') {
    return t('content.date.scheduled')
  }
  return t('content.date.modified')
}

/** The date the column shows: the publish date when the item has been or will be published, otherwise the last change. */
export function shownDate(item: ContentListItem): string {
  return item.status === 'publish' || item.status === 'future' || item.status === 'private'
    ? (item.publishedAt ?? item.modifiedAt)
    : item.modifiedAt
}

/** A title, or WordPress' «(ingen tittel)» for an item without one. */
export function titleOf(t: MessageT, title: string): string {
  return title.trim() === '' ? t('content.noTitle') : title
}

/** «— » for each level below the top, as WordPress shows child pages. */
export function depthPrefix(depth: number): string {
  return '— '.repeat(depth)
}

/** A month of the date filter (`2026-10`) as «oktober 2026», in the admin's language. */
export function monthLabel(month: string, locale: string): string {
  const [year, number] = month.split('-').map(Number)
  if (year === undefined || number === undefined || Number.isNaN(year) || Number.isNaN(number)) {
    return month
  }
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, number - 1, 1)),
  )
}

export type BulkAction = 'edit' | 'trash' | 'restore' | 'delete'

/** The answer to a bulk action as one line and the reasons for what was left alone. */
export function describeBulk(
  t: MessageT,
  action: BulkAction | 'empty_trash',
  response: ContentBulkResponse,
): { tone: 'success' | 'warning' | 'info'; title: string; details: string[] } {
  const n = response.changed.length
  let title: string
  switch (action) {
    case 'edit':
      title = t('content.bulkDone.edited', { n }, n)
      break
    case 'trash':
      title = t('content.bulkDone.trashed', { n }, n)
      break
    case 'restore':
      title = t('content.bulkDone.restored', { n }, n)
      break
    case 'delete':
    case 'empty_trash':
      title = t('content.bulkDone.deleted', { n }, n)
      break
    default:
      title = action satisfies never
  }
  const details: string[] = []
  const count = (reason: string) => response.skipped.filter((entry) => entry.reason === reason).length
  const forbidden = count('forbidden') + count('not_found')
  if (forbidden > 0) details.push(t('content.bulkSkipped.forbidden', { n: forbidden }, forbidden))
  const state = count('trashed') + count('not_trashed')
  if (state > 0) details.push(t('content.bulkSkipped.state', { n: state }, state))
  const invalid = count('invalid')
  if (invalid > 0) details.push(t('content.bulkSkipped.invalid', { n: invalid }, invalid))
  if (response.unchanged.length > 0) {
    details.push(t('content.bulkSkipped.unchanged', { n: response.unchanged.length }, response.unchanged.length))
  }
  const tone = details.length > 0 && response.skipped.length > 0 ? 'warning' : n > 0 ? 'success' : 'info'
  return { tone, title, details }
}

/** The text for an error code of the content API, or undefined to fall back to the shared messages. */
export function contentErrorText(t: MessageT, code: string | undefined): string | undefined {
  switch (code) {
    case 'cannot_publish':
      return t('content.errors.cannotPublish')
    case 'cannot_assign_authors':
      return t('content.errors.cannotAssignAuthors')
    case 'cannot_stick':
      return t('content.errors.cannotStick')
    case 'invalid_schedule':
      return t('content.errors.invalidSchedule')
    case 'invalid_parent':
      return t('content.errors.invalidParent')
    case 'invalid_author':
      return t('content.errors.invalidAuthor')
    case 'private_with_password':
      return t('content.errors.privateWithPassword')
    case 'content_trashed':
      return t('content.errors.trashed')
    case 'not_trashed':
      return t('content.errors.notTrashed')
    case 'not_found':
      return t('content.errors.notFound')
    default:
      return undefined
  }
}
