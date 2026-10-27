<script setup lang="ts">
import type { Block } from '@toascribe/blocks'

// A paragraph: its rich text, with the «/» menu while it is empty and the formatting in its toolbar.
defineProps<{ block: Block; parentType: string | null; selected: boolean }>()
const { t } = useI18n()
</script>

<template>
  <EditorRichText
    :block="block"
    :label="t('editorPrototype.paragraph.label')"
    :placeholder="t('editorPrototype.paragraph.placeholder')"
    :parent-type="parentType"
    :selected="selected"
    slash
    toolbar
    text-class="leading-relaxed"
  />
</template>
