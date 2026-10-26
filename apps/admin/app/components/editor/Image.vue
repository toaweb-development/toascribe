<script setup lang="ts">
import type { Block } from '@toascribe/blocks'
import { isSafeMediaUrl } from '@toascribe/blocks'

// An image: from an uploaded file (kept in the api's temporary folder until the media library of M1.2) or from an address, with
// alt text and a caption. Every change goes to the editor's model; typing in one field of one image is one step of the history.
const props = defineProps<{ block: Block; selected: boolean }>()

const editor = useBlockEditorContext()
const prototypeApi = useEditorPrototypeApi()
const { t } = useI18n()
const uid = useId()

const text = (key: string): string => {
  const value = props.block.attrs[key]
  return typeof value === 'string' ? value : ''
}
const url = computed(() => text('url'))

const alt = computed({
  get: () => text('alt'),
  set: (value: string) => editor.setAttrs(props.block.id, { alt: value }, `alt:${props.block.id}`),
})
const caption = computed({
  get: () => text('caption'),
  set: (value: string) => editor.setAttrs(props.block.id, { caption: value }, `caption:${props.block.id}`),
})

const address = ref('')
const addressError = ref(false)
const uploading = ref(false)
const uploadError = ref(false)

function useAddress(): void {
  const value = address.value.trim()
  // Only https: the admin's pages are served over https behind the proxy, and its CSP lets images in from https: only.
  if (!value.startsWith('https://') || !isSafeMediaUrl(value)) {
    addressError.value = true
    return
  }
  addressError.value = false
  editor.setAttrs(props.block.id, { url: value })
  address.value = ''
  focusFieldSoon()
}

/** The field that had the focus is gone once the image is there: the alt text takes it, so the next thing to write is next. */
function focusFieldSoon(): void {
  void nextTick(() => handler.focus())
}

async function onFile(event: Event): Promise<void> {
  const input = event.target instanceof HTMLInputElement ? event.target : null
  const file = input?.files?.[0]
  if (file === undefined) {
    return
  }
  uploading.value = true
  uploadError.value = false
  try {
    const { url: stored } = await prototypeApi.upload(file)
    editor.setAttrs(props.block.id, { url: stored })
    focusFieldSoon()
  } catch {
    uploadError.value = true
  } finally {
    uploading.value = false
    if (input !== null) {
      input.value = ''
    }
  }
}

const root = useTemplateRef<HTMLElement>('root')
const handler = {
  focus() {
    // The first field (the file, or the alt text once there is an image), not the toolbar above it.
    ;(root.value?.querySelector<HTMLElement>('input') ?? root.value?.querySelector<HTMLElement>('button'))?.focus()
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
        v-if="url !== ''"
        icon="i-lucide-replace"
        color="neutral"
        variant="ghost"
        size="xs"
        :label="t('editorPrototype.image.replace')"
        @click="editor.setAttrs(block.id, { url: '' })"
      />
    </EditorToolbar>

    <div v-if="url === ''" class="flex flex-col gap-3 rounded-md border border-dashed border-accented p-3">
      <p class="text-sm text-muted">{{ t('editorPrototype.image.empty') }}</p>
      <UFormField
        :label="t('editorPrototype.image.file')"
        :error="uploadError ? t('editorPrototype.image.uploadFailed') : undefined"
        :help="uploading ? t('editorPrototype.image.uploading') : undefined"
      >
        <UInput type="file" accept="image/png,image/jpeg,image/gif,image/webp" :disabled="uploading" @change="onFile" />
      </UFormField>
      <form class="flex flex-wrap items-start gap-2" @submit.prevent="useAddress">
        <UFormField
          :label="t('editorPrototype.image.url')"
          :error="addressError ? t('editorPrototype.image.urlInvalid') : undefined"
          class="min-w-60 flex-1"
        >
          <UInput v-model="address" type="url" inputmode="url" autocomplete="off" class="w-full" />
        </UFormField>
        <UButton type="submit" size="sm" class="mt-6" :label="t('editorPrototype.image.insertUrl')" />
      </form>
    </div>

    <template v-else>
      <figure class="flex flex-col gap-2">
        <!-- Prettier writes a void element with a slash, which this rule forbids: the two disagree, so the rule is off for this tag. -->
        <!-- eslint-disable vue/html-self-closing -->
        <img :src="url" :alt="alt" class="h-auto max-h-96 max-w-full self-start rounded-md" />
        <!-- eslint-enable vue/html-self-closing -->
      </figure>
      <UFormField
        :label="t('editorPrototype.image.alt')"
        :help="t('editorPrototype.image.altHelp')"
        :name="`${uid}-alt`"
      >
        <UInput v-model="alt" class="w-full" maxlength="1000" />
      </UFormField>
      <UFormField :label="t('editorPrototype.image.caption')" :name="`${uid}-caption`">
        <UInput v-model="caption" class="w-full" maxlength="2000" />
      </UFormField>
    </template>
  </div>
</template>
