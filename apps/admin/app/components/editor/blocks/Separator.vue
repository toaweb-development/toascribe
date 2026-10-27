<script setup lang="ts">
import type { Block } from '@toascribe/blocks'

// A separator (K-078): a line between sections. It has nothing to edit; it takes the focus so it can be moved and deleted.
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
      :aria-label="t('blocks.separator')"
      class="rounded py-3 outline-none focus-visible:ring-2 focus-visible:ring-primary"
      @focus="focusable.onFocus"
    >
      <!-- Prettier writes a void element with a slash, which this rule forbids: the two disagree, so the rule is off for this tag. -->
      <!-- eslint-disable-next-line vue/html-self-closing -->
      <hr class="border-accented" />
    </div>
  </div>
</template>
