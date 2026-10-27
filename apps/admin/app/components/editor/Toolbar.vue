<script setup lang="ts">
import type { Block } from '@toascribe/blocks'
import { locate } from '@toascribe/blocks'
import type { DropdownMenuItem } from '@nuxt/ui'

// The toolbar of the block that has the cursor: move up and down, insert after, delete, and what the block adds in the slot
// (formatting for a paragraph, the columns' count). A toolbar in the WAI-ARIA sense: one tab stop is enough for a person who knows
// it, but the buttons are plain buttons in the tab order, which is easier to find and what Gutenberg does too.
const props = defineProps<{ block: Block }>()

const editor = useBlockEditorContext()
const { title } = useBlockText()
const { t } = useI18n()
const toast = useToast()

const name = computed(() => title(props.block.type))
const parentType = computed(() => locate(editor.document.value, props.block.id)?.parentType ?? null)

// As in the inserter: once a block is chosen, the menu does not give the focus back to its button; the new block has it.
let chosen = false
const insertItems = computed<DropdownMenuItem[]>(() =>
  editorInsertableBlocks(parentType.value, editor.scope.value).map((definition) => ({
    label: title(definition.name),
    icon: definition.icon,
    onSelect: () => {
      chosen = true
      editor.insertAfter(props.block.id, definition.name)
    },
  })),
)
const menuContent = {
  align: 'start' as const,
  onCloseAutoFocus: (event: Event) => {
    if (chosen) {
      event.preventDefault()
      chosen = false
    }
  },
}

function move(direction: 'up' | 'down') {
  if (!editor.move(props.block.id, direction)) {
    toast.add({ title: t('editorPrototype.cannotMove'), color: 'neutral' })
  }
}
</script>

<template>
  <div
    role="toolbar"
    :aria-label="t('editorPrototype.blockTools', { name })"
    class="flex flex-wrap items-center gap-1 rounded-md border border-default bg-default p-1"
  >
    <span class="px-1 text-xs font-medium text-muted">{{ name }}</span>
    <UButton
      icon="i-lucide-arrow-up"
      color="neutral"
      variant="ghost"
      size="xs"
      :aria-label="t('editorPrototype.moveUp')"
      aria-keyshortcuts="Alt+Shift+ArrowUp"
      @click="move('up')"
    />
    <UButton
      icon="i-lucide-arrow-down"
      color="neutral"
      variant="ghost"
      size="xs"
      :aria-label="t('editorPrototype.moveDown')"
      aria-keyshortcuts="Alt+Shift+ArrowDown"
      @click="move('down')"
    />
    <slot />
    <UDropdownMenu :items="insertItems" :content="menuContent">
      <UButton
        icon="i-lucide-plus"
        color="neutral"
        variant="ghost"
        size="xs"
        :aria-label="t('editorPrototype.insertAfter')"
      />
    </UDropdownMenu>
    <UButton
      icon="i-lucide-trash-2"
      color="error"
      variant="ghost"
      size="xs"
      :aria-label="t('editorPrototype.remove')"
      aria-keyshortcuts="Alt+Shift+Z"
      @click="editor.remove(block.id)"
    />
  </div>
</template>
