<script setup lang="ts">
import type { Block } from '@toascribe/blocks'
import { COLUMNS, IMAGE, PARAGRAPH, contentOf, isSafeMediaUrl } from '@toascribe/blocks'

// How a block looks on the site (View, PLAN «Regler for blokker» 3): plain semantic HTML that the server renders, with no script.
// The prototype keeps the views in the admin, for its preview; in phase 1 they move to a place the site and themes share.
const props = defineProps<{ block: Block }>()

const text = (key: string): string => {
  const value = props.block.attrs[key]
  return typeof value === 'string' ? value : ''
}
const url = computed(() => (isSafeMediaUrl(text('url')) ? text('url') : ''))
// Static class names, so Tailwind finds them: one column on a phone, the block's count from the small breakpoint up.
const GRID: Readonly<Record<number, string>> = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4' }
</script>

<template>
  <p v-if="block.type === PARAGRAPH" class="leading-relaxed">
    <BlocksRichTextNode v-for="(node, index) in contentOf(block)" :key="index" :node="node" />
  </p>
  <figure v-else-if="block.type === IMAGE && url !== ''" class="flex flex-col gap-2">
    <!-- Prettier writes a void element with a slash, which this rule forbids: the two disagree, so the rule is off for this tag. -->
    <!-- eslint-disable vue/html-self-closing -->
    <img :src="url" :alt="text('alt')" class="h-auto max-w-full rounded-md" loading="lazy" />
    <!-- eslint-enable vue/html-self-closing -->
    <figcaption v-if="text('caption') !== ''" class="text-sm text-muted">{{ text('caption') }}</figcaption>
  </figure>
  <div v-else-if="block.type === COLUMNS" :class="['grid grid-cols-1 gap-6', GRID[block.children.length]]">
    <div v-for="column in block.children" :key="column.id" class="flex min-w-0 flex-col gap-4">
      <BlocksBlock v-for="child in column.children" :key="child.id" :block="child" />
    </div>
  </div>
</template>
