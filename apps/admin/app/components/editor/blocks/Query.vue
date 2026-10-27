<script setup lang="ts">
import type { Block } from '@toascribe/blocks'
import type { PublicListResponse } from '@toascribe/shared'

// The Query Loop (K-085): a list of published posts or pages that the site draws when the page is shown. In the editor it says what it
// will list and shows the items it would list now (the public reading API); its choices are in the sidebar.
const props = defineProps<{ block: Block; parentType: string | null; selected: boolean }>()
const { t } = useI18n()
const focusable = useFocusableBlock(() => props.block.id)
const publicApi = usePublicApi()

const query = computed(() => queryLoopQuery(props.block.attrs))
const items = ref<PublicListResponse['items']>([])
const failed = ref(false)
watch(
  query,
  async (value) => {
    try {
      items.value = (await publicApi.query(value)).items
      failed.value = false
    } catch {
      items.value = []
      failed.value = true
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex flex-col gap-1">
    <EditorToolbar v-if="selected" :block="block" />
    <div
      :ref="focusable.ref"
      tabindex="0"
      role="group"
      :aria-label="t('blocks.query')"
      class="flex flex-col gap-2 rounded border border-dashed border-accented p-3 outline-none focus-visible:ring-2 focus-visible:ring-primary"
      @focus="focusable.onFocus"
    >
      <p class="text-sm font-semibold text-highlighted">{{ queryLoopSummary(t, block.attrs) }}</p>
      <p v-if="failed" class="text-sm text-muted">{{ t('editor.query.failed') }}</p>
      <p v-else-if="items.length === 0" class="text-sm text-muted">{{ t('editor.query.empty') }}</p>
      <ul v-else class="list-disc ps-5 text-sm">
        <li v-for="item in items" :key="item.id">{{ item.title || t('editor.query.untitled') }}</li>
      </ul>
    </div>
  </div>
</template>
