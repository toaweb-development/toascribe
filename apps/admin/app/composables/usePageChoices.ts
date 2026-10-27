import type { ContentListStatus } from '@toascribe/shared'

/**
 * The pages to choose from in a settings field (the front page, the posts page, the privacy page): title, with «— » per level as
 * WordPress' dropdown, and id. Read once when the screen opens; `status` narrows it (only published pages for the front page).
 */
export async function usePageChoices(key: string, status: ContentListStatus) {
  const contentApi = useContentApi()
  const { t } = useI18n()
  return await useAsyncData(
    `page-choices:${key}`,
    async () => {
      const answer = await contentApi.list({ type: 'page', status, per_page: 100, orderby: 'title', order: 'asc' })
      return answer.items.map((item) => ({
        label: `${'— '.repeat(item.depth)}${titleOf(t, item.title)}`,
        value: item.id,
      }))
    },
    { default: () => [] as { label: string; value: string }[] },
  )
}
