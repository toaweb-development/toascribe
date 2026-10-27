<script setup lang="ts">
import type { Block } from '@toascribe/blocks'
import { QUOTE } from '@toascribe/blocks'

// A quote (K-078): the quoted blocks (paragraphs, headings, lists) and who said it.
defineProps<{ block: Block; parentType: string | null; selected: boolean }>()
const { t } = useI18n()
</script>

<template>
  <div class="flex flex-col gap-1 border-s-4 border-accented ps-3">
    <EditorBlockList :blocks="block.children" :parent-id="block.id" :parent-type="QUOTE" />
    <EditorRichText
      :block="block"
      attr="citation"
      :primary="false"
      enter="none"
      :label="t('editor.quote.citation')"
      :placeholder="t('editor.quote.citation')"
      text-class="text-sm text-muted"
    />
  </div>
</template>
