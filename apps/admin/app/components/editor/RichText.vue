<script setup lang="ts">
import { Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { Editor, EditorContent } from '@tiptap/vue-3'
import type { FunctionalComponent } from 'vue'

import { renderInline } from '@toascribe/block-views'
import type { Block, BlockDefinition, InlineNode } from '@toascribe/blocks'
import { inlineText, isSafeHref, normalizeInline } from '@toascribe/blocks'

// One rich text of a block (a paragraph's, a heading's, a list item's, a quote's citation, a table cell, a button's text). Until it
// gets the focus it is drawn as the view draws it (block-views renderInline), with no editor behind it; the first focus or click
// makes its TipTap instance and puts the cursor where the click was (decision note 0001, adjustment 1: a long document starts fast).
// The block tree owns the text; TipTap only mirrors it. Each change TipTap makes goes to the editor's model as a text step (typing,
// grouped) or a format step, and the model's one history undoes it, so TipTap has no history of its own.
const props = withDefaults(
  defineProps<{
    block: Block
    /** The attribute this text is (`content` for a text block). */
    attr?: string
    /** For an attribute that is not the block's own text: the value, when it is not `block.attrs[attr]` (a table cell). */
    value?: readonly InlineNode[]
    label: string
    placeholder?: string
    /** Enter: `split` makes the next block (a text block), `break` a line break (preformatted), `none` nothing (a cell, a button). */
    enter?: 'split' | 'break' | 'none'
    /** The «/» menu of an empty paragraph. */
    slash?: boolean
    parentType?: string | null
    /** Draws the formatting buttons in the block's toolbar while selected (the block's own tools go in the slot). */
    toolbar?: boolean
    selected?: boolean
    /** Tab and Shift+Tab indent and outdent (a list item). */
    listItem?: boolean
    /** Classes of the text (a heading's size). */
    textClass?: string
    /** Takes the cursor when the editor gives it to the block (false for a second text of a block, a quote's citation). */
    primary?: boolean
  }>(),
  {
    attr: 'content',
    value: undefined,
    placeholder: undefined,
    enter: 'split',
    slash: false,
    parentType: null,
    toolbar: false,
    selected: false,
    listItem: false,
    textClass: '',
    primary: true,
  },
)
/** A text that is not stored as an attribute of the block (a table cell): the change goes to the block, which knows where it lives. */
const emit = defineEmits<{ change: [content: InlineNode[], kind: 'text' | 'format', before: number, after: number] }>()

const editor = useBlockEditorContext()
const { title } = useBlockText()
const { t } = useI18n()
const uid = useId()

const content = computed<readonly InlineNode[]>(() => {
  if (props.value !== undefined) return props.value
  const raw = props.block.attrs[props.attr]
  return Array.isArray(raw) ? (raw as InlineNode[]) : []
})
const plain = computed(() => inlineText(content.value))
/** The content TipTap shows, as last sent to or read from it: a block whose content is this one needs no update. */
let mirrored: readonly InlineNode[] = content.value

/** The text as the site draws it, until the editor is made. */
const StaticText: FunctionalComponent<{ nodes: readonly InlineNode[] }> = (staticProps) =>
  renderInline(staticProps.nodes)

// --- The «/» menu: an empty paragraph with «/» and a word opens a list of the blocks that may stand here. ---------------------
const slashQuery = computed(() =>
  props.slash && /^\/[^\s/]*$/.test(plain.value) ? plain.value.slice(1).toLowerCase() : null,
)
const slashDismissed = ref(false)
const slashActive = ref(0)
const slashOptions = computed<BlockDefinition[]>(() => {
  const query = slashQuery.value
  if (query === null) return []
  return editorInsertableBlocks(props.parentType, editor.scope.value).filter(
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
  if (definition !== undefined) editor.replace(props.block.id, definition.name)
}

// --- Links ----------------------------------------------------------------------------------------------------------------------
const linkOpen = ref(false)
const linkHref = ref('')
const linkError = ref(false)
let linkRange: { from: number; to: number } | undefined
const linkInput = useTemplateRef<{ inputRef?: HTMLInputElement | null }>('linkInput')

function openLink(): boolean {
  const instance = tiptap.value
  if (instance === undefined) return false
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
  if (instance === undefined || linkRange === undefined) return
  if (href !== '' && !isSafeHref(href)) {
    linkError.value = true
    return
  }
  const chain = instance.chain().focus().setTextSelection(linkRange).extendMarkRange('link')
  if (href === '') chain.unsetLink().run()
  else chain.setLink({ href }).run()
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
  if (props.enter === 'break') {
    return tiptap.value?.commands.setHardBreak() ?? false
  }
  if (props.enter === 'none') return true
  const instance = tiptap.value
  const paragraph = paragraphNode()
  if (instance === undefined || paragraph === undefined) return false
  if (props.listItem && paragraph.content.size === 0) {
    editor.enterOnEmptyItem(props.block.id)
    return true
  }
  const { from, to } = instance.state.selection
  // Positions inside the paragraph's content start at 1 in the document (0 is before the paragraph).
  const before = normalizeInline(paragraph.content.cut(0, from - 1).toJSON())
  const after = normalizeInline(paragraph.content.cut(to - 1).toJSON())
  editor.split(props.block.id, before, after, from - 1)
  return true
}

function onBackspace(): boolean {
  if (props.enter !== 'split') return false
  const instance = tiptap.value
  const paragraph = paragraphNode()
  if (instance === undefined || paragraph === undefined) return false
  const { empty, from } = instance.state.selection
  if (!empty || from !== 1) return false
  editor.backspaceAtStart(props.block.id, paragraph.content.size === 0)
  return true
}

function atEdge(direction: 'up' | 'down'): boolean {
  const instance = tiptap.value
  if (instance === undefined) return false
  const { empty, from } = instance.state.selection
  const end = instance.state.doc.content.size - 1
  return empty && (direction === 'up' ? from === 1 : from === end)
}

function onArrow(direction: 'up' | 'down'): boolean {
  if (slashOpen.value) {
    const count = slashOptions.value.length
    if (count > 0) {
      slashActive.value = (slashActive.value + (direction === 'down' ? 1 : count - 1)) % count
      refreshAttributes()
    }
    return true
  }
  if (!atEdge(direction)) return false
  const target = editor.neighbour(props.block.id, direction)
  if (target === null) return false
  editor.focus({ blockId: target, offset: direction === 'up' ? Number.MAX_SAFE_INTEGER : 0 })
  return true
}

/** Shift+arrow at the edge of the text: the selection grows to the block before or after (decision note 0001, adjustment 3). */
function onShiftArrow(direction: 'up' | 'down'): boolean {
  if (!atEdge(direction)) return false
  editor.extendSelectionBy(direction)
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
      'Shift-ArrowUp': () => onShiftArrow('up'),
      'Shift-ArrowDown': () => onShiftArrow('down'),
      Escape: () => onEscape(),
      'Mod-k': () => openLink(),
      Tab: () => props.listItem && editor.indent(props.block.id),
      'Shift-Tab': () => props.listItem && editor.outdent(props.block.id),
    }
  },
})

// --- TipTap, made at the first focus ---------------------------------------------------------------------------------------------
function attributes(): Record<string, string> {
  const open = slashOpen.value && slashOptions.value.length > 0
  return {
    role: 'textbox',
    'aria-multiline': props.enter === 'none' ? 'false' : 'true',
    'aria-label': props.label,
    ...(props.placeholder === undefined ? {} : { 'aria-placeholder': props.placeholder }),
    ...(props.slash ? { 'aria-autocomplete': 'list' } : {}),
    ...(open ? { 'aria-controls': listboxId, 'aria-activedescendant': optionId(slashActive.value) } : {}),
    class: `min-h-7 whitespace-pre-wrap break-words rounded px-2 py-1 outline-none ${props.textClass}`,
  }
}

/** The cursor position before the transaction now being applied (TipTap emits `transaction` before `update`). */
let lastFrom = 1
let fromBeforeChange = 1
const tick = ref(0)
const tiptap = shallowRef<Editor>()
const root = useTemplateRef<HTMLElement>('root')

function report(nodes: InlineNode[], kind: 'text' | 'format', before: number, after: number): void {
  if (props.value !== undefined) {
    emit('change', nodes, kind, before, after)
  } else {
    editor.setText(props.block.id, nodes, kind, before, after, props.attr)
  }
}

/** Makes the editor and puts the cursor at a text position, or where a click was (screen coordinates). */
function activate(at: { offset?: number; x?: number; y?: number } = {}): void {
  if (tiptap.value !== undefined) {
    void placeCursor(at)
    return
  }
  mirrored = content.value
  tiptap.value = new Editor({
    content: toEditorDoc(content.value),
    // The editor's CSS is in the admin's stylesheet: the injected <style> has no nonce, and the CSP would refuse it.
    injectCSS: false,
    extensions: [...richTextExtensions(), BlockKeys],
    editorProps: { attributes: attributes() },
    onTransaction({ transaction }) {
      if (transaction.docChanged) fromBeforeChange = lastFrom
      lastFrom = transaction.selection.from
      tick.value += 1
    },
    onUpdate({ editor: instance, transaction }) {
      const nodes = fromEditorDoc(instance.getJSON())
      mirrored = nodes
      report(nodes, changeKind(transaction), fromBeforeChange - 1, instance.state.selection.from - 1)
    },
    onFocus({ editor: instance }) {
      editor.select({ blockId: props.block.id, offset: instance.state.selection.from - 1 })
    },
    onSelectionUpdate({ editor: instance }) {
      if (instance.isFocused) editor.select({ blockId: props.block.id, offset: instance.state.selection.from - 1 })
    },
  })
  // EditorContent puts the view in the page on the next render (a microtask, before the next key arrives).
  void nextTick(() => placeCursor(at))
}

/**
 * Focuses the editor and puts the cursor there, at once: TipTap's `focus` command waits a frame, and keys typed meanwhile (right after
 * a click, as a quick typist or a test does) would go nowhere.
 */
async function placeCursor(at: { offset?: number; x?: number; y?: number }): Promise<void> {
  const instance = tiptap.value
  if (instance === undefined) return
  // EditorContent moves the view into the page a tick after it mounts: wait for that (microtasks, before the next key).
  for (let tries = 0; tries < 5 && !instance.view.dom.isConnected; tries += 1) await nextTick()
  if (!instance.view.dom.isConnected) return
  const end = instance.state.doc.content.size - 1
  let position = at.offset === undefined ? end : Math.min(1 + Math.max(0, at.offset), end)
  if (at.x !== undefined && at.y !== undefined) {
    const found = instance.view.posAtCoords({ left: at.x, top: at.y })
    position = found === null ? end : Math.min(Math.max(1, found.pos), end)
  }
  instance.view.focus()
  instance.view.dispatch(instance.state.tr.setSelection(TextSelection.create(instance.state.doc, position)))
}

function refreshAttributes(): void {
  tiptap.value?.setOptions({ editorProps: { attributes: attributes() } })
}
watch([slashOpen, () => slashOptions.value.length, () => props.label], refreshAttributes)

// Content from outside (undo, redo, split, merge): put it into TipTap without an update, so it is not recorded again.
watch(content, (next) => {
  if (next === mirrored) return
  mirrored = next
  tiptap.value?.commands.setContent(toEditorDoc(next), { emitUpdate: false })
})

/** The static text was clicked: make the editor and put the cursor where the pointer was. */
function onStaticPointer(event: MouseEvent): void {
  if (event.shiftKey) return
  event.preventDefault()
  activate({ x: event.clientX, y: event.clientY })
}

const handler = { focus: (offset?: number) => activate({ offset }) }
// A block's main text takes the cursor the editor gives the block; a second text (a quote's citation) or a table's cells leave it to
// the block's own handler.
onMounted(() => {
  if (props.primary && props.value === undefined) editor.registerFocus(props.block.id, handler)
})
onBeforeUnmount(() => {
  editor.unregisterFocus(props.block.id, handler)
  tiptap.value?.destroy()
})

defineExpose({ activate, root })

// --- Formatting buttons ---------------------------------------------------------------------------------------------------------
type Mark = 'bold' | 'italic' | 'code'
const isActive = (name: Mark | 'link') => tick.value >= 0 && tiptap.value?.isActive(name) === true
function toggle(mark: Mark): void {
  const chain = tiptap.value?.chain().focus()
  if (mark === 'bold') chain?.toggleBold().run()
  else if (mark === 'italic') chain?.toggleItalic().run()
  else chain?.toggleCode().run()
}
const formatButtons = computed(() => [
  { mark: 'bold' as const, icon: 'i-lucide-bold', label: t('editorPrototype.paragraph.bold'), keys: 'Control+B' },
  { mark: 'italic' as const, icon: 'i-lucide-italic', label: t('editorPrototype.paragraph.italic'), keys: 'Control+I' },
  { mark: 'code' as const, icon: 'i-lucide-code', label: t('editorPrototype.paragraph.code'), keys: 'Control+E' },
])
</script>

<template>
  <div ref="root" class="flex flex-col gap-1" :data-enter="enter">
    <EditorToolbar v-if="toolbar && selected" :block="block">
      <slot name="tools" />
      <div role="group" :aria-label="t('editorPrototype.paragraph.formatting')" class="flex items-center gap-1">
        <UButton
          v-for="button in formatButtons"
          :key="button.mark"
          :icon="button.icon"
          color="neutral"
          :variant="isActive(button.mark) ? 'soft' : 'ghost'"
          size="xs"
          :aria-label="button.label"
          :aria-pressed="isActive(button.mark)"
          :aria-keyshortcuts="button.keys"
          @mousedown.prevent
          @click="toggle(button.mark)"
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
        v-if="plain === '' && placeholder !== undefined && (selected || !tiptap)"
        aria-hidden="true"
        :class="['pointer-events-none absolute top-1 left-2 text-muted', textClass]"
        >{{ placeholder }}</span
      >
      <EditorContent v-if="tiptap" :editor="tiptap" />
      <div
        v-else
        role="textbox"
        tabindex="0"
        :aria-label="label"
        :aria-multiline="enter === 'none' ? 'false' : 'true'"
        :aria-placeholder="placeholder"
        data-static-text
        :class="['min-h-7 cursor-text whitespace-pre-wrap break-words rounded px-2 py-1 outline-none', textClass]"
        @focus="activate()"
        @mousedown="onStaticPointer"
      >
        <StaticText :nodes="content" />
      </div>
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
