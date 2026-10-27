import type { ContentListItem, ContentListQueryInput } from '@toascribe/shared'

/** The most list pages read (100 items each): a site with more than 5000 pages sees the first 5000 in the order asked. */
const MAX_LIST_PAGES = 50

/**
 * Every item of a content list, read 100 at a time: for a box that offers all the pages (a parent, the front page, a menu's
 * «Sider»), so a site with more than 100 pages can choose any of them (the api gives at most 100 in one answer).
 */
export async function listAll(
  list: (query: ContentListQueryInput) => Promise<{ items: ContentListItem[]; totalPages: number }>,
  query: Omit<ContentListQueryInput, 'page' | 'per_page'>,
): Promise<ContentListItem[]> {
  const items: ContentListItem[] = []
  for (let page = 1; page <= MAX_LIST_PAGES; page += 1) {
    const answer = await list({ ...query, per_page: 100, page })
    items.push(...answer.items)
    if (page >= answer.totalPages) break
  }
  return items
}
