// The Query Loop's attributes as the public api's query, and as a sentence for the editor (K-085). The site's view builds the same
// query (site-core, Scribe/QueryLoop.vue).
import type { PublicQueryInput } from '@toascribe/shared'

type MessageT = (key: string, values?: Record<string, unknown>) => string

const text = (attrs: Readonly<Record<string, unknown>>, key: string, fallback: string): string => {
  const value = attrs[key]
  return typeof value === 'string' ? value : fallback
}

export function queryLoopQuery(attrs: Readonly<Record<string, unknown>>): PublicQueryInput {
  const sticky = text(attrs, 'sticky', 'include')
  const category = text(attrs, 'category', '')
  const tag = text(attrs, 'tag', '')
  const perPage = typeof attrs['perPage'] === 'number' ? attrs['perPage'] : 5
  return {
    type: text(attrs, 'postType', 'post') === 'page' ? 'page' : 'post',
    per_page: perPage,
    orderby: text(attrs, 'orderBy', 'date') === 'title' ? 'title' : 'date',
    order: text(attrs, 'order', 'desc') === 'asc' ? 'asc' : 'desc',
    ...(category === '' ? {} : { category }),
    ...(tag === '' ? {} : { tag }),
    ...(sticky === 'exclude' ? { exclude_sticky: 'true' } : sticky === 'first' ? { sticky_first: 'true' } : {}),
  }
}

/** «De 5 nyeste innleggene i kategorien «mat»». */
export function queryLoopSummary(t: MessageT, attrs: Readonly<Record<string, unknown>>): string {
  const query = queryLoopQuery(attrs)
  const n = query.per_page
  const what = query.type === 'page' ? t('editor.query.pages', { n }) : t('editor.query.posts', { n })
  const order =
    query.orderby === 'title'
      ? t('editor.query.byTitle')
      : query.order === 'asc'
        ? t('editor.query.oldest')
        : t('editor.query.newest')
  const filters = [
    query.category === undefined ? undefined : t('editor.query.inCategory', { slug: query.category }),
    query.tag === undefined ? undefined : t('editor.query.withTag', { slug: query.tag }),
  ].filter((part) => part !== undefined)
  return [order, what, ...filters].join(' ')
}
