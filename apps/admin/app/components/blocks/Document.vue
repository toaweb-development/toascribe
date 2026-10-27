<script setup lang="ts">
import { BlockDocument } from '@toascribe/block-views'
import { validateDocument } from '@toascribe/blocks'
import type { ContentMediaRef } from '@toascribe/shared'

// A stored block document as the site draws it (packages/block-views). The blocks are checked against their block.json first, here
// too: what the api stored passed the same check, so a failure means the data was changed behind the api's back. It is then not
// shown at all (PLAN: an invalid block is an error box, never a broken page).
const props = defineProps<{ blocks: readonly unknown[]; media?: readonly ContentMediaRef[] }>()

// The media the image blocks use: given with the document, or (in the editor) the ones it keeps while editing.
const known = useMediaRefs()
const media = computed(() => props.media ?? [...known.value.values()])
const result = computed(() => validateDocument(props.blocks))
</script>

<template>
  <BlockDocument v-if="result.ok" :blocks="result.blocks" :media="media" />
  <UAlert
    v-else
    color="error"
    variant="subtle"
    icon="i-lucide-triangle-alert"
    :title="$t('editorPrototype.previewPage.invalid')"
  />
</template>
