<script setup lang="ts">
import { Extension } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/vue-3'

import type { Block, BlockDefinition, InlineNode } from '@toascribe/blocks'
import { contentOf, inlineText, isSafeHref, normalizeInline } from '@toascribe/blocks'

// A paragraph: its own TipTap instance for the formatting inside the text (bold, italic, code, link, line break), and nothing
// else. The block tree owns the paragraph; TipTap only mirrors the block's content. Each change TipTap makes goes to the editor's
// model as a text step (typing, grouped) or a format step, and the model's one history undoes it, so TipTap has no history of
// its own (no UndoRedo extension). When the block's content changes from outside (undo, redo, a split), the new content is set
// into TipTap without an update event, so it does not come back as a new step.
const props = defineProps<{ block: Block; parentType: string | null; selected: boolean }>()

const editor = useBlockEditorContext()
const { title } = useBlockText()
const { t } = useI18n()
const uid = useId()

const content = computed(() => contentOf(props.block))
/** The content TipTap shows, as last sent to or read from it: a block whose content is this one needs no update. */
let mirrored: readonly InlineNode[] = content.value

// --- The «/» menu: an empty paragraph with «/» and a word opens a list of the blocks that may stand here. ---------------------
const plain = computed(() => inlineText(content.value))
const slashQuery = computed(() => (/^\/[^\s/]*$/.test(plain.value) ? plain.value.slice(1).toLowerCase() : null))
const slashDismissed = ref(false)
const slashActive = ref(0)
const slashOptions = computed<BlockDefinition[]>(() => {
  const query = slashQuery.value
  if (query === null) {
    return []
  }
  return editorInsertableBlocks(props.parentType).filter(
    (definition) =>
      title(definition.name).toLowerCase().includes(query) ||
      definition.name.includes(query) ||
      definition.keywords.some((keyword) => keyword.includes(query)),
  )
})
const slashOpen = computed(() => props.selected && slashQuery.value !== null && !slashDismissed.value)
const listboxId = `${uid}-blocks`
const optionId = (index: number) => `${uid}-block-${String(index)}`

watch(slashQuery, () => {
  slashActive.value = 0
  slashDismissed.value = false
})

function chooseSlash(index: number): void {
  const definition = slashOptions.value[index]
  if (definition !== undefined) {
    editor.replace(props.block.id, definition.name)
  }
}

// --- Links ----------------------------------------------------------------------------------------------------------------------
const linkOpen = ref(false)
const linkHref = ref('')
const linkError = ref(false)
let linkRange: { from: number; to: number } | undefined
const linkInput = useTemplateRef<{ inputRef?: HTMLInputElement | null }>('linkInput')

function openLink(): boolean {
  const instance = tiptap.value
  if (instance === undefined) {
    return false
  }
  const { from, to } = instance.state.selection
  linkRange = { from, to }
  const current: unknown = instance.getAttributes('link')['href']
  linkHref.value = typeof current === 'string' ? current : ''
  linkError.value = false
  linkOpen.value = true
  void nextTick(() => linkInput.value?.inputRef?.focus())
  return true
}

function closeLink(): void {
  linkOpen.value = false
  tiptap.value?.commands.focus()
}

function applyLink(): void {
  const instance = tiptap.value
  const href = linkHref.value.trim()
  if (instance === undefined || linkRange === undefined) {
    return
  }
  if (href !== '' && !isSafeHref(href)) {
    linkError.value = true
    return
  }
  const chain = instance.chain().focus().setTextSelection(linkRange).extendMarkRange('link')
  if (href === '') {
    chain.unsetLink().run()
  } else {
    chain.setLink({ href }).run()
  }
  linkOpen.value = false
}

function removeLink(): void {
  linkHref.value = ''
  applyLink()
}

// --- Keys -----------------------------------------------------------------------------------------------------------------------
function paragraphNode() {
  return tiptap.value?.state.doc.firstChild ?? undefined
}

function onEnter(): boolean {
  if (slashOpen.value) {
    chooseSlash(slashActive.value)
    return true
  }
  const instance = tiptap.value
  const paragraph = paragraphNode()
  if (instance === undefined || paragraph === undefined) {
    return false
  }
  const { from, to } = instance.state.selection
  // Positions inside the paragraph's content start at 1 in the document (0 is before the paragraph).
  const before = normalizeInline(paragraph.content.cut(0, from - 1).toJSON())
  const after = normalizeInline(paragraph.content.cut(to - 1).toJSON())
  editor.split(props.block.id, before, after, from - 1)
  return true
}

function onBackspace(): boolean {
  const instance = tiptap.value
  const paragraph = paragraphNode()
  if (instance === undefined || paragraph === undefined) {
    return false
  }
  const { empty, from } = instance.state.selection
  if (!empty || from !== 1) {
    return false
  }
  editor.backspaceAtStart(props.block.id, paragraph.content.size === 0)
  return true
}

function onArrow(direction: 'up' | 'down'): boolean {
  const instance = tiptap.value
  if (instance === undefined) {
    return false
  }
  if (slashOpen.value) {
    const count = slashOptions.value.length
    if (count > 0) {
      slashActive.value = (slashActive.value + (direction === 'down' ? 1 : count - 1)) % count
      refreshAttributes()
    }
    return true
  }
  const { empty, from } = instance.state.selection
  const end = instance.state.doc.content.size - 1
  if (!empty || (direction === 'up' ? from !== 1 : from !== end)) {
    return false
  }
  const target = editor.neighbour(props.block.id, direction)
  if (target === null) {
    return false
  }
  editor.focus({ blockId: target, offset: direction === 'up' ? Number.MAX_SAFE_INTEGER : 0 })
  return true
}

function onEscape(): boolean {
  if (slashOpen.value) {
    slashDismissed.value = true
    refreshAttributes()
    return true
  }
  return false
}

const BlockKeys = Extension.create({
  name: 'toascribeBlockKeys',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: () => onEnter(),
      Backspace: () => onBackspace(),
      ArrowUp: () => onArrow('up'),
      ArrowDown: () => onArrow('down'),
      Escape: () => onEscape(),
      'Mod-k': () => openLink(),
    }
  },
})

// --- TipTap ---------------------------------------------------------------------------------------------------------------------
function attributes(): Record<string, string> {
  const open = slashOpen.value && slashOptions.value.length > 0
  return {
    role: 'textbox',
    'aria-multiline': 'true',
    'aria-label': t('editorPrototype.paragraph.label'),
    'aria-placeholder': t('editorPrototype.paragraph.placeholder'),
    'aria-autocomplete': 'list',
    ...(open ? { 'aria-controls': listboxId, 'aria-activedescendant': optionId(slashActive.value) } : {}),
    class: 'min-h-7 whitespace-pre-wrap break-words rounded px-2 py-1 leading-relaxed outline-none',
  }
}

/** The cursor position before the transaction now being applied (TipTap emits `transaction` before `update`). */
let lastFrom = 1
let fromBeforeChange = 1
const tick = ref(0)

const tiptap = useEditor({
  content: toEditorDoc(content.value),
  // The editor's CSS is in the admin's stylesheet: the injected <style> has no nonce, and the CSP would refuse it.
  injectCSS: false,
  extensions: [...richTextExtensions(), BlockKeys],
  editorProps: { attributes: attributes() },
  onTransaction({ transaction }) {
    if (transaction.docChanged) {
      fromBeforeChange = lastFrom
    }
    lastFrom = transaction.selection.from
    tick.value += 1
  },
  onUpdate({ editor: instance, transaction }) {
    const nodes = fromEditorDoc(instance.getJSON())
    mirrored = nodes
    editor.setText(
      props.block.id,
      nodes,
      changeKind(transaction),
      fromBeforeChange - 1,
      instance.state.selection.from - 1,
    )
  },
  onFocus({ editor: instance }) {
    editor.select({ blockId: props.block.id, offset: instance.state.selection.from - 1 })
  },
  onSelectionUpdate({ editor: instance }) {
    if (instance.isFocused) {
      editor.select({ blockId: props.block.id, offset: instance.state.selection.from - 1 })
    }
  },
})

function refreshAttributes(): void {
  tiptap.value?.setOptions({ editorProps: { attributes: attributes() } })
}
watch([slashOpen, () => slashOptions.value.length], refreshAttributes)

// Content from outside (undo, redo, split, merge): put it into TipTap without an update, so it is not recorded again.
watch(content, (next) => {
  if (next === mirrored) {
    return
  }
  mirrored = next
  tiptap.value?.commands.setContent(toEditorDoc(next), { emitUpdate: false })
})

const handler = {
  focus(offset?: number) {
    const instance = tiptap.value
    if (instance === undefined) {
      return
    }
    const end = instance.state.doc.content.size - 1
    instance.commands.focus(offset === undefined ? end : Math.min(1 + Math.max(0, offset), end))
  },
}
onMounted(() => editor.registerFocus(props.block.id, handler))
onBeforeUnmount(() => editor.unregisterFocus(props.block.id, handler))

// --- Formatting buttons ---------------------------------------------------------------------------------------------------------
type Mark = 'bold' | 'italic' | 'code'
const isActive = (name: Mark | 'link') => tick.value >= 0 && tiptap.value?.isActive(name) === true

function toggle(mark: Mark): void {
  const chain = tiptap.value?.chain().focus()
  if (mark === 'bold') chain?.toggleBold().run()
  else if (mark === 'italic') chain?.toggleItalic().run()
  else chain?.toggleCode().run()
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <EditorToolbar v-if="selected" :block="block">
      <div role="group" :aria-label="t('editorPrototype.paragraph.formatting')" class="flex items-center gap-1">
        <UButton
          icon="i-lucide-bold"
          color="neutral"
          :variant="isActive('bold') ? 'soft' : 'ghost'"
          size="xs"
          :aria-label="t('editorPrototype.paragraph.bold')"
          :aria-pressed="isActive('bold')"
          aria-keyshortcuts="Control+B"
          @mousedown.prevent
          @click="toggle('bold')"
        />
        <UButton
          icon="i-lucide-italic"
          color="neutral"
          :variant="isActive('italic') ? 'soft' : 'ghost'"
          size="xs"
          :aria-label="t('editorPrototype.paragraph.italic')"
          :aria-pressed="isActive('italic')"
          aria-keyshortcuts="Control+I"
          @mousedown.prevent
          @click="toggle('italic')"
        />
        <UButton
          icon="i-lucide-code"
          color="neutral"
          :variant="isActive('code') ? 'soft' : 'ghost'"
          size="xs"
          :aria-label="t('editorPrototype.paragraph.code')"
          :aria-pressed="isActive('code')"
          aria-keyshortcuts="Control+E"
          @mousedown.prevent
          @click="toggle('code')"
        />
        <UButton
          icon="i-lucide-link"
          color="neutral"
          :variant="isActive('link') ? 'soft' : 'ghost'"
          size="xs"
          :aria-label="t('editorPrototype.paragraph.link')"
          :aria-pressed="isActive('link')"
          aria-keyshortcuts="Control+K"
          :aria-expanded="linkOpen"
          @mousedown.prevent
          @click="openLink"
        />
      </div>
    </EditorToolbar>

    <form
      v-if="linkOpen"
      class="flex flex-wrap items-start gap-2"
      @submit.prevent="applyLink"
      @keydown.esc.prevent="closeLink"
    >
      <UFormField
        :label="t('editorPrototype.paragraph.linkUrl')"
        :error="linkError ? t('editorPrototype.paragraph.linkInvalid') : undefined"
        class="min-w-60 flex-1"
      >
        <UInput ref="linkInput" v-model="linkHref" type="url" inputmode="url" autocomplete="off" class="w-full" />
      </UFormField>
      <div class="flex gap-1 pt-6">
        <UButton type="submit" size="sm" :label="t('editorPrototype.paragraph.linkApply')" />
        <UButton
          v-if="isActive('link')"
          size="sm"
          color="neutral"
          variant="outline"
          :label="t('editorPrototype.paragraph.linkRemove')"
          @click="removeLink"
        />
        <UButton
          size="sm"
          color="neutral"
          variant="ghost"
          :label="t('editorPrototype.paragraph.linkCancel')"
          @click="closeLink"
        />
      </div>
    </form>

    <div class="relative">
      <span
        v-if="plain === '' && selected"
        aria-hidden="true"
        class="pointer-events-none absolute top-1 left-2 text-dimmed"
        >{{ t('editorPrototype.paragraph.placeholder') }}</span
      >
      <EditorContent :editor="tiptap" />
    </div>

    <div v-if="slashOpen" class="rounded-md border border-default bg-default p-1 shadow-sm">
      <ul
        v-if="slashOptions.length > 0"
        :id="listboxId"
        role="listbox"
        :aria-label="t('editorPrototype.paragraph.slashMenu')"
      >
        <li
          v-for="(definition, index) in slashOptions"
          :id="optionId(index)"
          :key="definition.name"
          role="option"
          :aria-selected="index === slashActive"
          :class="[
            'flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm',
            index === slashActive ? 'bg-elevated text-highlighted' : 'text-default',
          ]"
          @mousedown.prevent="chooseSlash(index)"
        >
          <UIcon :name="definition.icon" class="size-4" aria-hidden="true" />
          {{ title(definition.name) }}
        </li>
      </ul>
      <p v-else class="px-2 py-1 text-sm text-muted">{{ t('editorPrototype.paragraph.slashNone') }}</p>
    </div>
  </div>
</template>
