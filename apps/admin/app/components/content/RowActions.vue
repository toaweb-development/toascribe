<script setup lang="ts">
import type { ContentListItem } from '@toascribe/shared'

// The row actions under a title (WordPress' «Rediger | Hurtigredigering | Papirkurv | Forhåndsvis», the last a signed link to the site; in the trash «Gjenopprett | Slett
// permanent»). Only the actions the account may take on this item are drawn (`can` from the api). Each names its item for a screen
// reader, because «Rediger» alone repeats down the list.
const props = defineProps<{
  item: ContentListItem
  inTrash: boolean
  editPath: string
  actionClass: string
  dangerClass: string
}>()

const emit = defineEmits<{ quickEdit: []; trash: []; restore: []; remove: [] }>()

const { t } = useI18n()
const named = computed(() => titleOf(t, props.item.title))
const contentApi = useContentApi()
const toast = useToast()

/**
 * «Forhåndsvis» (K-071): a signed link to the item on the site, drawn by the active theme, as the editor's button. The tab is opened in
 * the click, before anything is awaited, or the browser blocks it as a pop-up.
 */
async function preview(): Promise<void> {
  const target = window.open('about:blank', '_blank')
  // The site's page must not reach back into the signed-in admin window.
  if (target !== null) target.opener = null
  try {
    const link = await contentApi.previewLink(props.item.id)
    if (target !== null) target.location.href = link.path
  } catch {
    target?.close()
    toast.add({ title: t('editor.previewFailed'), color: 'error' })
  }
}
</script>

<template>
  <ul class="flex flex-wrap items-center gap-x-3 gap-y-0" :aria-label="$t('content.actions.label', { title: named })">
    <template v-if="!inTrash">
      <li v-if="item.can.edit">
        <NuxtLink :to="editPath" :class="actionClass" :aria-label="$t('content.actions.editNamed', { title: named })">
          {{ $t('content.actions.edit') }}
        </NuxtLink>
      </li>
      <li v-if="item.can.edit">
        <button
          type="button"
          :class="actionClass"
          :aria-label="$t('content.actions.quickEditNamed', { title: named })"
          @click="emit('quickEdit')"
        >
          {{ $t('content.actions.quickEdit') }}
        </button>
      </li>
      <li v-if="item.can.delete">
        <button
          type="button"
          :class="dangerClass"
          :aria-label="$t('content.actions.trashNamed', { title: named })"
          @click="emit('trash')"
        >
          {{ $t('content.actions.trash') }}
        </button>
      </li>
      <li v-if="item.can.edit">
        <button
          type="button"
          :class="actionClass"
          :aria-label="$t('content.actions.previewNamed', { title: named })"
          @click="preview"
        >
          {{ $t('content.actions.preview') }}
        </button>
      </li>
    </template>
    <template v-else-if="item.can.delete">
      <li>
        <button
          type="button"
          :class="actionClass"
          :aria-label="$t('content.actions.restoreNamed', { title: named })"
          @click="emit('restore')"
        >
          {{ $t('content.actions.restore') }}
        </button>
      </li>
      <li>
        <button
          type="button"
          :class="dangerClass"
          :aria-label="$t('content.actions.removeNamed', { title: named })"
          @click="emit('remove')"
        >
          {{ $t('content.actions.remove') }}
        </button>
      </li>
    </template>
  </ul>
</template>
