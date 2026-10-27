<script setup lang="ts">
import type { Block } from '@toascribe/blocks'

// A page break (K-227): the post goes on on the next page here. The site's paging of a post comes in M1.4.
const props = defineProps<{ block: Block; parentType: string | null; selected: boolean }>()
const { t } = useI18n()
const focusable = useFocusableBlock(() => props.block.id)
</script>

<template>
  <div class="flex flex-col gap-1">
    <EditorToolbar v-if="selected" :block="block" />
    <div
      :ref="focusable.ref"
      tabindex="0"
      role="group"
      :aria-label="t('blocks.nextpage')"
      class="flex items-center gap-3 rounded py-2 text-xs font-semibold text-muted uppercase outline-none focus-visible:ring-2 focus-visible:ring-primary"
      @focus="focusable.onFocus"
    >
      <span class="flex-1 border-t-2 border-dashed border-accented" aria-hidden="true" />
      {{ t('blocks.nextpage') }}
      <span class="flex-1 border-t-2 border-dashed border-accented" aria-hidden="true" />
    </div>
  </div>
</template>
