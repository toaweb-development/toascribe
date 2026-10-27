import type { ContentListStatus } from '@toascribe/shared'

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
      const items = await listAll(contentApi.list, { type: 'page', status, orderby: 'title', order: 'asc' })
      const choices = items.map((item) => ({
        label: `${'— '.repeat(item.depth)}${titleOf(t, item.title)}`,
        value: item.id,
      }))
      return choices
    },
    { default: () => [] as { label: string; value: string }[] },
  )
}
