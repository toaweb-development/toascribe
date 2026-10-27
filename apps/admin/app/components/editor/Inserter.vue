<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

import type { Place } from '@toascribe/blocks'

// The «+» of the editor (Gutenberg's inserter): a menu of the blocks that may stand at `place`. `subtle` is the small button between
// two blocks, shown when the pointer is near; it is left out of the tab order, because each block's toolbar has «Sett inn blokk
// etter» and an empty paragraph takes «/». The one at the end of a list is a normal button.
const props = defineProps<{ place: Place; parentType: string | null; subtle?: boolean; label?: string }>()

const editor = useBlockEditorContext()
const { title } = useBlockText()
const { t } = useI18n()

// When a block was chosen, the menu must not hand the focus back to its button as it closes: the new block has the cursor.
let chosen = false
const items = computed<DropdownMenuItem[]>(() =>
  editorInsertableBlocks(props.parentType).map((definition) => ({
    label: title(definition.name),
    icon: definition.icon,
    onSelect: () => {
      chosen = true
      editor.insertAt(props.place, definition.name)
    },
  })),
)
const content = {
  align: 'start' as const,
  onCloseAutoFocus: (event: Event) => {
    if (chosen) {
      event.preventDefault()
      chosen = false
    }
  },
}
</script>

<template>
  <UDropdownMenu :items="items" :content="content">
    <UButton
      icon="i-lucide-plus"
      color="neutral"
      :variant="subtle ? 'ghost' : 'outline'"
      :size="subtle ? 'xs' : 'sm'"
      :tabindex="subtle ? -1 : undefined"
      :aria-label="label ?? t('editorPrototype.insertHere')"
      :label="subtle ? undefined : label"
      :class="subtle ? 'opacity-0 transition-opacity group-hover/between:opacity-100 focus-visible:opacity-100' : ''"
    />
  </UDropdownMenu>
</template>
