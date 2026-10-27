<script setup lang="ts">
import type { BlockDefinition, Place } from '@toascribe/blocks'

// The «+» of the editor (Gutenberg's inserter, K-081): a search field and the blocks that may stand at `place`, by category (text,
// media, design, widgets). Typing filters by name, keyword and type; Enter in the field takes the first block. `subtle` is the small
// button between two blocks, shown when the pointer is near; it is left out of the tab order, because each block's toolbar has «Sett
// inn blokk etter» and an empty paragraph takes «/». The one at the end of a list is a normal button.
const props = defineProps<{ place: Place; parentType: string | null; subtle?: boolean; label?: string }>()

const editor = useBlockEditorContext()
const { title } = useBlockText()
const { t } = useI18n()
const uid = useId()

const open = ref(false)
const query = ref('')
watch(open, (value) => {
  if (value) query.value = ''
})

const matches = computed<BlockDefinition[]>(() => {
  const words = query.value.trim().toLowerCase()
  return editorInsertableBlocks(props.parentType, editor.scope.value).filter(
    (definition) =>
      words === '' ||
      title(definition.name).toLowerCase().includes(words) ||
      definition.name.includes(words) ||
      definition.keywords.some((keyword) => keyword.includes(words)),
  )
})
const groups = computed(() =>
  INSERTER_CATEGORIES.map((category) => ({
    category,
    label: categoryLabel(t, category),
    blocks: matches.value.filter((definition) => definition.category === category),
  })).filter((group) => group.blocks.length > 0),
)

// When a block was chosen, the popover must not hand the focus back to its button as it closes: the new block has the cursor (and a
// space typed into it would otherwise press the button).
let chosen = false
const content = {
  align: 'start' as const,
  onCloseAutoFocus: (event: Event) => {
    if (chosen) {
      event.preventDefault()
      chosen = false
    }
  },
}

function choose(definition: BlockDefinition | undefined): void {
  if (definition === undefined) return
  chosen = true
  open.value = false
  // The chosen button keeps the focus while the popover closes: a key pressed meanwhile would press it again.
  ;(document.activeElement as HTMLElement | null)?.blur()
  editor.insertAt(props.place, definition.name)
}
</script>

<template>
  <UPopover v-model:open="open" :content="content">
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
    <template #content>
      <div class="flex max-h-96 w-72 flex-col gap-2 overflow-y-auto p-2">
        <UInput
          :id="`${uid}-search`"
          v-model="query"
          type="search"
          icon="i-lucide-search"
          size="sm"
          autofocus
          :aria-label="t('editor.inserter.search')"
          :placeholder="t('editor.inserter.search')"
          @keydown.enter.prevent="choose(matches[0])"
        />
        <section v-for="group in groups" :key="group.category" :aria-labelledby="`${uid}-${group.category}`">
          <h3 :id="`${uid}-${group.category}`" class="px-1 pb-1 text-xs font-semibold text-muted uppercase">
            {{ group.label }}
          </h3>
          <ul class="grid grid-cols-3 gap-1">
            <li v-for="definition in group.blocks" :key="definition.name">
              <button
                type="button"
                class="flex min-h-16 w-full flex-col items-center justify-center gap-1 rounded-md p-1 text-center text-xs text-default hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
                @click="choose(definition)"
              >
                <UIcon :name="definition.icon" class="size-5" aria-hidden="true" />
                {{ title(definition.name) }}
              </button>
            </li>
          </ul>
        </section>
        <p v-if="groups.length === 0" class="px-1 text-sm text-muted" role="status">
          {{ t('editorPrototype.paragraph.slashNone') }}
        </p>
      </div>
    </template>
  </UPopover>
</template>
