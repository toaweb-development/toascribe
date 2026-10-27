<script setup lang="ts">
import type { Block } from '@toascribe/blocks'

// Code (K-078): plain text in a monospaced field, kept exactly as written (spaces, tabs, and markup as text). Typing is grouped into
// steps of the history like any text.
const props = defineProps<{ block: Block; parentType: string | null; selected: boolean }>()
const editor = useBlockEditorContext()
const { t } = useI18n()

const content = computed({
  get: () => (typeof props.block.attrs['content'] === 'string' ? props.block.attrs['content'] : ''),
  set: (value: string) => editor.setAttrs(props.block.id, { content: value }, `code:${props.block.id}`),
})
const field = useTemplateRef<{ textareaRef?: HTMLTextAreaElement | null }>('field')
const handler = { focus: () => field.value?.textareaRef?.focus() }
onMounted(() => editor.registerFocus(props.block.id, handler))
onBeforeUnmount(() => editor.unregisterFocus(props.block.id, handler))
</script>

<template>
  <div class="flex flex-col gap-1" @focusin="selected || editor.select({ blockId: block.id })">
    <EditorToolbar v-if="selected" :block="block" />
    <UTextarea
      ref="field"
      v-model="content"
      autoresize
      :rows="3"
      spellcheck="false"
      :aria-label="t('editor.code.label')"
      :placeholder="t('editor.code.placeholder')"
      class="w-full"
      :ui="{ base: 'font-mono text-sm' }"
      maxlength="100000"
    />
  </div>
</template>
