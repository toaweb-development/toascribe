<script setup lang="ts">
import type { Block } from '@toascribe/blocks'

// A spacer (K-078): white space in one of the theme's sizes (block settings), shown here as a box with its size.
const props = defineProps<{ block: Block; parentType: string | null; selected: boolean }>()
const { t } = useI18n()
const focusable = useFocusableBlock(() => props.block.id)
const size = computed(() => (typeof props.block.attrs['size'] === 'string' ? props.block.attrs['size'] : 'medium'))
const HEIGHT: Readonly<Record<string, string>> = { small: 'h-4', medium: 'h-12', large: 'h-24', 'x-large': 'h-40' }
const label = computed(() => spacerSizeLabel(t, size.value))
</script>

<template>
  <div class="flex flex-col gap-1">
    <EditorToolbar v-if="selected" :block="block" />
    <div
      :ref="focusable.ref"
      tabindex="0"
      role="group"
      :aria-label="t('editor.spacer.label', { size: label })"
      :class="[
        'flex items-center justify-center rounded border border-dashed border-default text-xs text-muted outline-none focus-visible:ring-2 focus-visible:ring-primary',
        HEIGHT[size] ?? 'h-12',
      ]"
      @focus="focusable.onFocus"
    >
      {{ label }}
    </div>
  </div>
</template>
