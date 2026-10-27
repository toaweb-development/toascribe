import type { ContentListStatus } from '@toascribe/shared'

/** The most list pages read (100 items each): a site with more pages than this chooses among the first 5000 by title. */
const MAX_LIST_PAGES = 50

/**
 * The pages to choose from in a settings field (the front page, the posts page, the privacy page): title, with «— » per level as
 * WordPress' dropdown, and id. Read once when the screen opens, every page of the list (the api gives 100 at a time); `status`
 * narrows it (only published pages for the front page).
 */
export async function usePageChoices(key: string, status: ContentListStatus) {
  const contentApi = useContentApi()
  const { t } = useI18n()
  return await useAsyncData(
    `page-choices:${key}`,
    async () => {
      const choices: { label: string; value: string }[] = []
      for (let page = 1; page <= MAX_LIST_PAGES; page += 1) {
        const answer = await contentApi.list({
          type: 'page',
          status,
          per_page: 100,
          page,
          orderby: 'title',
          order: 'asc',
        })
        for (const item of answer.items) {
          choices.push({ label: `${'— '.repeat(item.depth)}${titleOf(t, item.title)}`, value: item.id })
        }
        if (page >= answer.totalPages) break
      }
      return choices
    },
    { default: () => [] as { label: string; value: string }[] },
  )
}
