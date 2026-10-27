<script setup lang="ts">
// The blocks of an item or a teaser (PLAN «Regler et tema må følge» 3). The core view of each block, or the theme's own
// (`blocks/<name>/View.vue`). Custom HTML is written as markup here, on the public site only (Tor's decision, M1.4): only an account
// with unfiltered_html can write it, and the admin always shows its source (SECURITY.md).
import type { Block } from '@toascribe/blocks'
import { BlockDocument, DEFAULT_IMAGE_SIZES } from '@toascribe/block-views'
import type { ContentMediaRef } from '@toascribe/shared'
import { blockViews } from '#toascribe/theme'

const props = withDefaults(
  defineProps<{
    /** Blocks as the public api gives them (they passed validateDocument there). */
    blocks: readonly Record<string, unknown>[] | readonly Block[]
    media?: readonly ContentMediaRef[]
    /** `sizes` for an image across the content column; a theme with another width passes its own. */
    imageSizes?: string
  }>(),
  { media: () => [], imageSizes: DEFAULT_IMAGE_SIZES },
)

const blocks = computed(() => props.blocks as readonly Block[])
</script>

<template>
  <BlockDocument :blocks="blocks" :media="media" :image-sizes="imageSizes" html="raw" :views="blockViews" />
</template>
