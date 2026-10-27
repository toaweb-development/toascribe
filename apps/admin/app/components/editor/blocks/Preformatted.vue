<script setup lang="ts">
import type { Block } from '@toascribe/blocks'

// Preformatted text (K-079): rich text whose spaces and line breaks are kept; Enter is a line break, not a new block.
defineProps<{ block: Block; parentType: string | null; selected: boolean }>()
const { t } = useI18n()
</script>

<template>
  <EditorRichText
    :block="block"
    enter="break"
    :label="t('editor.preformatted.label')"
    :placeholder="t('editor.preformatted.placeholder')"
    :selected="selected"
    toolbar
    text-class="font-mono text-sm rounded-md border border-default bg-elevated"
  />
</template>
