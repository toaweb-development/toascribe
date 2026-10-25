<script setup lang="ts">
import type { InlineNode } from '@toascribe/blocks'
import { isSafeHref } from '@toascribe/blocks'

// One node of rich text with its marks, outermost first: the mark at `depth` wraps the rest. Every element is made by Vue from the
// data, and text is always printed as text, never as markup; a link whose address is not allowed is shown as plain text.
const props = withDefaults(defineProps<{ node: InlineNode; depth?: number }>(), { depth: 0 })

const mark = computed(() => (props.node.type === 'text' ? props.node.marks?.[props.depth] : undefined))
const href = computed(() =>
  mark.value?.type === 'link' && isSafeHref(mark.value.attrs.href) ? mark.value.attrs.href : undefined,
)
</script>

<template>
  <!-- Prettier writes a void element with a slash, which this rule forbids: the two disagree, so the rule is off for this tag. -->
  <!-- eslint-disable vue/html-self-closing -->
  <br v-if="node.type === 'hardBreak'" />
  <!-- eslint-enable vue/html-self-closing -->
  <template v-else-if="mark === undefined">{{ node.text }}</template>
  <strong v-else-if="mark.type === 'bold'"><BlocksRichTextNode :node="node" :depth="depth + 1" /></strong>
  <em v-else-if="mark.type === 'italic'"><BlocksRichTextNode :node="node" :depth="depth + 1" /></em>
  <code v-else-if="mark.type === 'code'"><BlocksRichTextNode :node="node" :depth="depth + 1" /></code>
  <a v-else-if="href !== undefined" :href="href" class="text-primary underline"
    ><BlocksRichTextNode :node="node" :depth="depth + 1"
  /></a>
  <BlocksRichTextNode v-else :node="node" :depth="depth + 1" />
</template>
