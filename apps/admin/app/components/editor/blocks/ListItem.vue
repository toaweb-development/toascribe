<script setup lang="ts">
import type { Block } from '@toascribe/blocks'
import { LIST_ITEM, locate } from '@toascribe/blocks'

// A list item: a marker (a bullet, or its number), its text, and a nested list below it. Tab puts it under the item before, Shift+Tab
// takes it out; Enter in an empty last item ends the list. The toolbar also switches the list between bullets and numbers.
const props = defineProps<{ block: Block; parentType: string | null; selected: boolean }>()
const editor = useBlockEditorContext()
const { t } = useI18n()

const where = computed(() => locate(editor.document.value, props.block.id))
const list = computed(() => {
  const parentId = where.value?.parentId
  return parentId == null ? undefined : locate(editor.document.value, parentId)?.block
})
const ordered = computed(() => list.value?.attrs['ordered'] === true)
const marker = computed(() => (ordered.value ? `${String((where.value?.index ?? 0) + 1)}.` : '•'))

function setOrdered(value: boolean): void {
  if (list.value !== undefined) editor.setAttrs(list.value.id, { ordered: value })
}
</script>

<template>
  <div class="flex flex-col">
    <div class="flex items-start gap-1">
      <span aria-hidden="true" class="min-w-5 pt-1 text-end text-muted">{{ marker }}</span>
      <EditorRichText
        :block="block"
        :label="t('editor.list.item')"
        :parent-type="LIST_ITEM"
        :selected="selected"
        list-item
        toolbar
        class="min-w-0 flex-1"
      >
        <template #tools>
          <UButton
            :icon="ordered ? 'i-lucide-list' : 'i-lucide-list-ordered'"
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="ordered ? t('editor.list.bullets') : t('editor.list.numbers')"
            @click="setOrdered(!ordered)"
          />
          <UButton
            icon="i-lucide-indent-increase"
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="t('editor.list.indent')"
            aria-keyshortcuts="Tab"
            @mousedown.prevent
            @click="editor.indent(block.id)"
          />
          <UButton
            icon="i-lucide-indent-decrease"
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="t('editor.list.outdent')"
            aria-keyshortcuts="Shift+Tab"
            @mousedown.prevent
            @click="editor.outdent(block.id)"
          />
        </template>
      </EditorRichText>
    </div>
    <div v-if="block.children.length > 0" class="ps-6">
      <EditorBlockList :blocks="block.children" :parent-id="block.id" :parent-type="LIST_ITEM" />
    </div>
  </div>
</template>
