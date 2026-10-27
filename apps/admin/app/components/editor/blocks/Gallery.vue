<script setup lang="ts">
import type { Block } from '@toascribe/blocks'
import { IMAGE, createBlock } from '@toascribe/blocks'
import { MediaPicker } from '#components'

// A gallery (K-078): images from the media library in columns. Each image is an image block (with its own alt text, required unless
// decorative); the columns, the cropping and the link (to the file or none) are the gallery's settings (block settings).
const props = defineProps<{ block: Block; parentType: string | null; selected: boolean }>()
const editor = useBlockEditorContext()
const mediaRefs = useMediaRefs()
const overlay = useOverlay()
const { t } = useI18n()

const pickerDialog = overlay.create(MediaPicker)
async function add(): Promise<void> {
  const item = await pickerDialog.open({})
  if (!item) {
    handler.focus()
    return
  }
  mediaRefs.value.set(item.id, refOfItem(item))
  editor.insertBlocks({ parentId: props.block.id, index: props.block.children.length }, [
    createBlock(IMAGE, { mediaId: item.id, alt: item.alt }),
  ])
  void nextTick(() => handler.focus())
}

const text = (block: Block, key: string) => (typeof block.attrs[key] === 'string' ? (block.attrs[key] as string) : '')
function setAlt(image: Block, value: string): void {
  editor.setAttrs(image.id, { alt: value }, `alt:${image.id}`)
}
const columns = computed(() => (typeof props.block.attrs['columns'] === 'number' ? props.block.attrs['columns'] : 3))
// Static class names, so Tailwind finds them.
const GRID: Readonly<Record<number, string>> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
  5: 'grid-cols-2 sm:grid-cols-5',
  6: 'grid-cols-3 sm:grid-cols-6',
  7: 'grid-cols-3 sm:grid-cols-7',
  8: 'grid-cols-4 sm:grid-cols-8',
}

const root = useTemplateRef<HTMLElement>('root')
const handler = {
  focus: () => root.value?.querySelector<HTMLElement>('input, [data-add-image]')?.focus(),
}
onMounted(() => editor.registerFocus(props.block.id, handler))
onBeforeUnmount(() => editor.unregisterFocus(props.block.id, handler))
</script>

<template>
  <div ref="root" class="flex flex-col gap-2" @focusin="selected || editor.select({ blockId: block.id })">
    <EditorToolbar v-if="selected" :block="block" />
    <ul v-if="block.children.length > 0" :class="['grid gap-2', GRID[columns]]">
      <li v-for="image in block.children" :key="image.id" class="flex flex-col gap-1">
        <!-- eslint-disable vue/html-self-closing -->
        <img
          v-if="mediaRefs.get(text(image, 'mediaId'))"
          :src="mediaRefs.get(text(image, 'mediaId'))?.url"
          :alt="text(image, 'alt')"
          :class="['w-full rounded-md', block.attrs['crop'] === true ? 'aspect-square object-cover' : 'h-auto']"
        />
        <!-- eslint-enable vue/html-self-closing -->
        <p v-else class="text-sm text-warning">{{ t('editorPrototype.image.missing') }}</p>
        <UInput
          :model-value="text(image, 'alt')"
          size="sm"
          :aria-label="t('editorPrototype.image.alt')"
          :placeholder="t('editorPrototype.image.alt')"
          maxlength="1000"
          @update:model-value="(value: string) => setAlt(image, value)"
        />
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          class="self-start"
          :label="t('editor.gallery.remove')"
          @click="editor.remove(image.id)"
        />
      </li>
    </ul>
    <p v-else class="text-sm text-muted">{{ t('editor.gallery.empty') }}</p>
    <UButton
      data-add-image
      icon="i-lucide-image-plus"
      class="min-h-11 self-start"
      :label="t('editor.gallery.add')"
      @click="add"
    />
  </div>
</template>
