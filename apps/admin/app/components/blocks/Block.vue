<script setup lang="ts">
import type { Block } from '@toascribe/blocks'
import { COLUMNS, IMAGE, PARAGRAPH, contentOf } from '@toascribe/blocks'

// How a block looks on the site (View, PLAN «Regler for blokker» 3): plain semantic HTML that the server renders, with no script.
// The prototype keeps the views in the admin, for its preview; in phase 1 they move to a place the site and themes share. An image is
// drawn from its media id (useMediaRefs) with srcset and sizes from the library's sizes; a decorative one has an empty alt.
const props = defineProps<{ block: Block }>()

const text = (key: string): string => {
  const value = props.block.attrs[key]
  return typeof value === 'string' ? value : ''
}
const mediaRefs = useMediaRefs()
const image = computed(() => (props.block.type === IMAGE ? mediaRefs.value.get(text('mediaId')) : undefined))
const decorative = computed(() => props.block.attrs['decorative'] === true)
/** The image fills the column it stands in, at most the content width (48rem, the article's max width). */
const SIZES = '(min-width: 48rem) 48rem, 100vw'
// Static class names, so Tailwind finds them: one column on a phone, the block's count from the small breakpoint up.
const GRID: Readonly<Record<number, string>> = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4' }
</script>

<template>
  <p v-if="block.type === PARAGRAPH" class="leading-relaxed">
    <BlocksRichTextNode v-for="(node, index) in contentOf(block)" :key="index" :node="node" />
  </p>
  <figure v-else-if="block.type === IMAGE && image !== undefined" class="flex flex-col gap-2">
    <!-- Prettier writes a void element with a slash, which this rule forbids: the two disagree, so the rule is off for this tag. -->
    <!-- eslint-disable vue/html-self-closing -->
    <img
      :src="image.url"
      :srcset="srcsetOf(image)"
      :sizes="SIZES"
      :width="image.width ?? undefined"
      :height="image.height ?? undefined"
      :alt="decorative ? '' : text('alt')"
      class="h-auto max-w-full rounded-md"
      loading="lazy"
      decoding="async"
    />
    <!-- eslint-enable vue/html-self-closing -->
    <figcaption v-if="text('caption') !== ''" class="text-sm text-muted">{{ text('caption') }}</figcaption>
  </figure>
  <div v-else-if="block.type === COLUMNS" :class="['grid grid-cols-1 gap-6', GRID[block.children.length]]">
    <div v-for="column in block.children" :key="column.id" class="flex min-w-0 flex-col gap-4">
      <BlocksBlock v-for="child in column.children" :key="child.id" :block="child" />
    </div>
  </div>
</template>
