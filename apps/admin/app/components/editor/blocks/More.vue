<script setup lang="ts">
import type { Block } from '@toascribe/blocks'

// «Les mer» (K-107, posts only): where the excerpt of an archive page ends. The link's text can be set; empty uses the theme's.
const props = defineProps<{ block: Block; parentType: string | null; selected: boolean }>()
const editor = useBlockEditorContext()
const { t } = useI18n()
const uid = useId()
const focusable = useFocusableBlock(() => props.block.id)
const customText = computed({
  get: () => (typeof props.block.attrs['customText'] === 'string' ? props.block.attrs['customText'] : ''),
  set: (value: string) => editor.setAttrs(props.block.id, { customText: value }, `more:${props.block.id}`),
})
</script>

<template>
  <div class="flex flex-col gap-1">
    <EditorToolbar v-if="selected" :block="block" />
    <div class="flex items-center gap-3">
      <span class="flex-1 border-t-2 border-dashed border-accented" aria-hidden="true" />
      <UInput
        :id="`${uid}-more`"
        :ref="(instance) => focusable.ref((instance as { inputRef?: HTMLElement | null } | null)?.inputRef ?? null)"
        v-model="customText"
        size="sm"
        maxlength="200"
        :aria-label="t('editor.more.text')"
        :placeholder="t('editor.more.placeholder')"
        class="w-48"
        @focus="focusable.onFocus"
      />
      <span class="flex-1 border-t-2 border-dashed border-accented" aria-hidden="true" />
    </div>
  </div>
</template>
