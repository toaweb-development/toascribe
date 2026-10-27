<script setup lang="ts">
import type { Block } from '@toascribe/blocks'
import { MediaPicker } from '#components'

// An image (M1.2): a file of the media library, chosen in the picker; the block stores its id, the alternative text, the caption and
// whether the picture is decorative (then it has no alternative text, and the view gives it an empty alt). The alternative text starts
// as the file's own, from the library, and can be changed here for this place. The address and the sizes come from the library
// (useMediaRefs), so a replaced or edited file shows at once everywhere. Every change goes to the editor's model; typing in one field
// of one image is one step of the history.
const props = defineProps<{ block: Block; parentType: string | null; selected: boolean }>()

const editor = useBlockEditorContext()
const mediaRefs = useMediaRefs()
const overlay = useOverlay()
const { t } = useI18n()
const uid = useId()

const text = (key: string): string => {
  const value = props.block.attrs[key]
  return typeof value === 'string' ? value : ''
}
const mediaId = computed(() => text('mediaId'))
const image = computed(() => (mediaId.value === '' ? undefined : mediaRefs.value.get(mediaId.value)))

const alt = computed({
  get: () => text('alt'),
  set: (value: string) => editor.setAttrs(props.block.id, { alt: value }, `alt:${props.block.id}`),
})
const caption = computed({
  get: () => text('caption'),
  set: (value: string) => editor.setAttrs(props.block.id, { caption: value }, `caption:${props.block.id}`),
})
const decorative = computed({
  get: () => props.block.attrs['decorative'] === true,
  set: (value: boolean) => editor.setAttrs(props.block.id, { decorative: value }),
})

const pickerDialog = overlay.create(MediaPicker)
async function pick(): Promise<void> {
  const item = await pickerDialog.open({ current: mediaId.value === '' ? undefined : mediaId.value })
  if (!item) {
    handler.focus()
    return
  }
  mediaRefs.value.set(item.id, refOfItem(item))
  editor.setAttrs(props.block.id, { mediaId: item.id, ...(alt.value === '' ? { alt: item.alt } : {}) })
  // The field that had the focus is gone once the image is there: the alt text takes it, so the next thing to write is next.
  void nextTick(() => handler.focus())
}

const root = useTemplateRef<HTMLElement>('root')
const handler = {
  focus() {
    // The first field (the alt text once there is an image) or the button that opens the library; not the toolbar above it.
    ;(
      root.value?.querySelector<HTMLElement>('textarea, input') ?? root.value?.querySelector<HTMLElement>('[data-pick]')
    )?.focus()
  },
}
onMounted(() => editor.registerFocus(props.block.id, handler))
onBeforeUnmount(() => editor.unregisterFocus(props.block.id, handler))

function onFocusIn(): void {
  if (!props.selected) {
    editor.select({ blockId: props.block.id })
  }
}
</script>

<template>
  <div ref="root" class="flex flex-col gap-2" @focusin="onFocusIn">
    <EditorToolbar v-if="selected" :block="block">
      <UButton
        v-if="mediaId !== ''"
        icon="i-lucide-replace"
        color="neutral"
        variant="ghost"
        size="xs"
        :label="t('editorPrototype.image.replace')"
        @click="pick"
      />
    </EditorToolbar>

    <div
      v-if="mediaId === ''"
      class="flex flex-col items-start gap-3 rounded-md border border-dashed border-accented p-3"
    >
      <p class="text-sm text-muted">{{ t('editorPrototype.image.empty') }}</p>
      <UButton
        data-pick
        icon="i-lucide-image"
        class="min-h-11"
        :label="t('editorPrototype.image.library')"
        @click="pick"
      />
    </div>

    <template v-else>
      <figure class="flex flex-col gap-2">
        <!-- Prettier writes a void element with a slash, which this rule forbids: the two disagree, so the rule is off for this tag. -->
        <!-- eslint-disable vue/html-self-closing -->
        <img
          v-if="image"
          :src="image.url"
          :srcset="srcsetOf(image)"
          sizes="(min-width: 48rem) 48rem, 100vw"
          :alt="decorative ? '' : alt"
          class="h-auto max-h-96 max-w-full self-start rounded-md"
        />
        <!-- eslint-enable vue/html-self-closing -->
        <p v-else class="text-sm text-warning">{{ t('editorPrototype.image.missing') }}</p>
      </figure>
      <UFormField
        :label="t('editorPrototype.image.alt')"
        :help="t('editorPrototype.image.altHelp')"
        :name="`${uid}-alt`"
        :required="!decorative"
      >
        <UTextarea v-model="alt" :rows="2" class="w-full" maxlength="1000" :disabled="decorative" />
      </UFormField>
      <UCheckbox v-model="decorative" :label="t('editorPrototype.image.decorative')" />
      <UFormField :label="t('editorPrototype.image.caption')" :name="`${uid}-caption`">
        <UInput v-model="caption" class="w-full" maxlength="2000" />
      </UFormField>
    </template>
  </div>
</template>
