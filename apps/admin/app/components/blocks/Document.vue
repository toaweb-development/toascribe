<script setup lang="ts">
import { validateDocument } from '@toascribe/blocks'
import type { ContentMediaRef } from '@toascribe/shared'

// A stored block document as HTML. The blocks are checked against their block.json first, here too: what the api stored passed
// the same check, so a failure means the data was changed behind the api's back. It is then not shown at all (PLAN: an invalid
// block is an error box, never a broken page).
const props = defineProps<{ blocks: readonly unknown[]; media?: readonly ContentMediaRef[] }>()

// The media the blocks use, for the image views below (a component that already provided them, the editor, keeps its own).
if (props.media !== undefined) {
  provideMediaRefs(props.media)
}

const result = computed(() => validateDocument(props.blocks))
</script>

<template>
  <div v-if="result.ok" class="flex flex-col gap-4">
    <BlocksBlock v-for="block in result.blocks" :key="block.id" :block="block" />
  </div>
  <UAlert
    v-else
    color="error"
    variant="subtle"
    icon="i-lucide-triangle-alert"
    :title="$t('editorPrototype.previewPage.invalid')"
  />
</template>
