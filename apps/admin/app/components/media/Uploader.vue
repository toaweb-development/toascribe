<script setup lang="ts">
import type { MediaItem } from '@toascribe/shared'

// «Last opp filer» (K-117, WordPress' «Legg til ny mediefil»): drop files on the area or choose them, each uploaded on its own with its
// progress; or give an address and the api fetches the file (safeFetch, no private addresses). The largest file and the allowed types come
// from the api for the signed-in account (`upload` of the list answer), so the page says what will be refused before it is sent. A file
// over the limit is refused here and by the api and the proxy.
const props = defineProps<{
  /** The largest file in bytes and the extensions this account may upload. */
  limits: { maxBytes: number; extensions: readonly string[] }
  /** The folder new files go into; null for the top. */
  folderId?: string | null
  /** Only images (the editor's picker). */
  imagesOnly?: boolean
}>()
const emit = defineEmits<{ uploaded: [item: MediaItem] }>()

const { t } = useI18n()
const upload = useMediaUpload()
const mediaApi = useMediaApi()
const uid = useId()

interface Entry {
  readonly key: number
  readonly name: string
  progress: number
  state: 'sending' | 'done' | 'failed'
  error?: string
  abort?: () => void
}
const entries = ref<Entry[]>([])
let serial = 0

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'jpe',
  'png',
  'gif',
  'webp',
  'avif',
  'tif',
  'tiff',
  'heic',
  'heif',
  'bmp',
  'ico',
])
const extensions = computed(() =>
  props.imagesOnly === true
    ? props.limits.extensions.filter((ext) => IMAGE_EXTENSIONS.has(ext))
    : props.limits.extensions,
)
const accept = computed(() => extensions.value.map((ext) => `.${ext}`).join(','))
const maxSize = computed(() => formatBytes(props.limits.maxBytes))

function errorText(caught: unknown): string {
  return mediaErrorText(t, caught instanceof ApiRequestError ? caught.code : undefined) ?? describeApiError(caught, t)
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

async function sendOne(file: File): Promise<void> {
  serial += 1
  const entry = reactive<Entry>({ key: serial, name: file.name, progress: 0, state: 'sending' })
  entries.value.unshift(entry)
  if (file.size > props.limits.maxBytes) {
    Object.assign(entry, { state: 'failed', error: t('media.errors.fileTooLarge') })
    return
  }
  if (!extensions.value.includes(extensionOf(file.name))) {
    Object.assign(entry, { state: 'failed', error: t('media.errors.unsupportedType') })
    return
  }
  const fields: Record<string, string> = {}
  if (props.folderId != null) fields.folderId = props.folderId
  const handle = upload.send('/v1/media', file, fields, (fraction) => {
    entry.progress = Math.round(fraction * 100)
  })
  entry.abort = handle.abort
  try {
    const item = await handle.done
    entry.state = 'done'
    emit('uploaded', item)
  } catch (caught) {
    Object.assign(entry, { state: 'failed', error: errorText(caught) })
  } finally {
    entry.abort = undefined
  }
}

async function sendAll(files: Iterable<File>): Promise<void> {
  // One at a time, as WordPress' uploader: the order is kept and the line is not filled by many large files at once.
  for (const file of files) {
    await sendOne(file)
  }
}

function onPicked(event: Event): void {
  const input = event.target instanceof HTMLInputElement ? event.target : null
  const files = input?.files === null || input?.files === undefined ? [] : [...input.files]
  if (input !== null) input.value = ''
  void sendAll(files)
}

const dragging = ref(false)
function onDrop(event: DragEvent): void {
  dragging.value = false
  void sendAll([...(event.dataTransfer?.files ?? [])])
}

const fileInput = useTemplateRef<{ inputRef: HTMLInputElement | null }>('fileInput')
function choose(): void {
  fileInput.value?.inputRef?.click()
}

// --- From an address -----------------------------------------------------------------------------------------------------------------
const address = ref('')
const fetching = ref(false)
const addressError = ref<string>()
async function fromAddress(): Promise<void> {
  if (fetching.value) return
  const value = address.value.trim()
  if (!/^https?:\/\/\S+$/i.test(value)) {
    addressError.value = t('media.upload.addressInvalid')
    return
  }
  fetching.value = true
  addressError.value = undefined
  try {
    const item = await mediaApi.fromUrl({ url: value, ...(props.folderId == null ? {} : { folderId: props.folderId }) })
    address.value = ''
    emit('uploaded', item)
  } catch (caught) {
    addressError.value = errorText(caught)
  } finally {
    fetching.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div
      data-testid="media-dropzone"
      class="flex flex-col items-center gap-3 rounded-md border-2 border-dashed p-6 text-center sm:p-10"
      :class="dragging ? 'border-primary bg-elevated' : 'border-accented'"
      @dragenter.prevent="dragging = true"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <p class="text-lg font-semibold text-highlighted">{{ $t('media.upload.drop') }}</p>
      <p class="text-sm text-toned">{{ $t('media.upload.or') }}</p>
      <UButton size="lg" class="min-h-11" icon="i-lucide-upload" @click="choose">{{
        $t('media.upload.choose')
      }}</UButton>
      <UInput
        :id="`${uid}-files`"
        ref="fileInput"
        type="file"
        multiple
        class="sr-only"
        tabindex="-1"
        aria-hidden="true"
        :accept="accept"
        @change="onPicked"
      />
      <p class="text-sm text-toned">{{ $t('media.upload.maxSize', { size: maxSize }) }}</p>
      <p class="max-w-prose text-xs text-muted wrap-anywhere">
        {{ $t('media.upload.types', { types: extensions.join(', ') }) }}
      </p>
    </div>

    <ul v-if="entries.length > 0" class="flex flex-col gap-2" :aria-label="$t('media.upload.queue')">
      <li v-for="entry in entries" :key="entry.key" class="flex flex-col gap-1 rounded-md border border-default p-3">
        <div class="flex items-center justify-between gap-2">
          <span class="min-w-0 truncate text-sm font-medium text-highlighted">{{ entry.name }}</span>
          <UButton
            v-if="entry.state === 'sending' && entry.abort"
            size="xs"
            color="neutral"
            variant="ghost"
            :label="$t('media.upload.cancel')"
            @click="entry.abort?.()"
          />
          <span v-else-if="entry.state === 'done'" class="text-sm text-success">{{ $t('media.upload.done') }}</span>
        </div>
        <UProgress
          v-if="entry.state === 'sending'"
          :model-value="entry.progress"
          :aria-label="$t('media.upload.progress', { name: entry.name })"
          size="sm"
        />
        <p v-if="entry.state === 'failed'" role="alert" class="text-sm text-error">{{ entry.error }}</p>
      </li>
    </ul>

    <form class="flex flex-col gap-2" @submit.prevent="fromAddress">
      <UFormField
        :label="$t('media.upload.fromUrl')"
        :help="$t('media.upload.fromUrlHelp')"
        :error="addressError"
        :name="`${uid}-url`"
      >
        <div class="flex flex-wrap gap-2">
          <UInput
            v-model="address"
            type="url"
            inputmode="url"
            size="xl"
            class="min-w-0 flex-1"
            autocomplete="off"
          />
          <UButton type="submit" color="neutral" variant="outline" size="lg" class="min-h-11" :loading="fetching">
            {{ $t('media.upload.fetch') }}
          </UButton>
        </div>
      </UFormField>
    </form>
  </div>
</template>
