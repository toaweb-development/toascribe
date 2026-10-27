<script setup lang="ts">
import { MEDIA_TEXT_MAX_LENGTH, MEDIA_TITLE_MAX_LENGTH } from '@toascribe/shared'
import type { MediaDetail, MediaFolderItem, MediaItem, UpdateMediaRequest } from '@toascribe/shared'
import { MediaImageEditor } from '#components'

// «Vedleggsdetaljer» (K-112, K-113, K-115, K-116, K-122): the file, its facts, the fields (alternative text, title, caption, description),
// who may see it and its folder, «Kopier URL til utklippstavlen», where it is used («Brukes på», from the content's references), and the
// actions: Rediger bilde, Erstatt (a new file under the same id: every place that uses it shows the new one), Lag bildestørrelser på
// nytt (manage_options), Slett permanent (with a warning that names where it is used). The api checks every right again.
const props = defineProps<{
  id: string
  folders: readonly MediaFolderItem[]
  mayManage: boolean
}>()
const emit = defineEmits<{ close: [changed: boolean] }>()

const { t, locale } = useI18n()
const mediaApi = useMediaApi()
const upload = useMediaUpload()
const confirm = useConfirmDialog()
const overlay = useOverlay()
const uid = useId()

const detail = ref<MediaDetail>()
const loadError = ref<string>()
const changed = ref(false)

function errorText(caught: unknown): string {
  return mediaErrorText(t, caught instanceof ApiRequestError ? caught.code : undefined) ?? describeApiError(caught, t)
}

const form = reactive({ fileTitle: '', alt: '', caption: '', about: '', visibility: 'public', folder: 'none' })
function fill(item: MediaItem): void {
  Object.assign(form, {
    fileTitle: item.title,
    alt: item.alt,
    caption: item.caption,
    about: item.description,
    visibility: item.visibility,
    folder: item.folderId ?? 'none',
  })
}

// While the worker makes the sizes (or the edited picture), the window asks again every two seconds, for at most two minutes, so the
// person sees the file become ready; the fields they are typing in are filled again only when nothing was changed in them.
const POLL_MS = 2000
const POLL_LIMIT = 60
let polls = 0
let timer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(timer))

function untouched(item: MediaItem): boolean {
  return (
    form.fileTitle === item.title &&
    form.alt === item.alt &&
    form.caption === item.caption &&
    form.about === item.description &&
    form.visibility === item.visibility &&
    form.folder === (item.folderId ?? 'none')
  )
}

async function load(poll = false): Promise<void> {
  loadError.value = undefined
  if (!poll) polls = 0
  try {
    const before = detail.value
    const next = await mediaApi.get(props.id)
    if (before === undefined || !poll || untouched(before)) fill(next)
    detail.value = next
    clearTimeout(timer)
    if (import.meta.client && next.processing === 'pending' && polls < POLL_LIMIT) {
      polls += 1
      timer = setTimeout(() => void load(true), POLL_MS)
    }
  } catch (caught) {
    loadError.value = errorText(caught)
  }
}
await load()

const item = computed(() => detail.value)
const isImage = computed(() => item.value?.group === 'image')
const mayEdit = computed(() => item.value?.can.edit === true)
const absoluteUrl = computed(() => (item.value ? new URL(item.value.url, useRequestURL().origin).href : ''))
const folderItems = computed(() => [
  { value: 'none', label: t('media.folders.none') },
  ...props.folders.map((folder) => ({ value: folder.id, label: `${'   '.repeat(folder.depth)}${folder.name}` })),
])
const visibilityItems = computed(() => [
  { value: 'public', label: t('media.details.public') },
  { value: 'private', label: t('media.details.private') },
])

// --- Save the fields -----------------------------------------------------------------------------------------------------------------
const saving = ref(false)
const report = ref<string>()
const failure = ref<string>()
async function save(): Promise<void> {
  const current = item.value
  if (!current || saving.value) return
  const request: UpdateMediaRequest = {}
  if (form.fileTitle !== current.title) request.title = form.fileTitle
  if (form.alt !== current.alt) request.alt = form.alt
  if (form.caption !== current.caption) request.caption = form.caption
  if (form.about !== current.description) request.description = form.about
  if (form.visibility !== current.visibility) request.visibility = form.visibility === 'private' ? 'private' : 'public'
  const folderId = form.folder === 'none' ? null : form.folder
  if (folderId !== current.folderId) request.folderId = folderId
  if (Object.keys(request).length === 0) return
  saving.value = true
  failure.value = undefined
  report.value = undefined
  try {
    await mediaApi.update(current.id, request)
    changed.value = true
    report.value = t('media.details.saved')
    await load()
  } catch (caught) {
    failure.value = errorText(caught)
  } finally {
    saving.value = false
  }
}

// --- Copy the address ------------------------------------------------------------------------------------------------------------------
const copied = ref(false)
async function copyUrl(): Promise<void> {
  try {
    await navigator.clipboard.writeText(absoluteUrl.value)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    failure.value = t('media.details.copyFailed')
  }
}

// --- Replace ---------------------------------------------------------------------------------------------------------------------------
const replacing = ref(false)
const replaceProgress = ref(0)
const replaceInput = useTemplateRef<{ inputRef: HTMLInputElement | null }>('replaceInput')
async function onReplace(event: Event): Promise<void> {
  const input = event.target instanceof HTMLInputElement ? event.target : null
  const file = input?.files?.[0]
  if (input !== null) input.value = ''
  const current = item.value
  if (!file || !current) return
  replacing.value = true
  replaceProgress.value = 0
  failure.value = undefined
  report.value = undefined
  try {
    await upload.send(`/v1/media/${encodeURIComponent(current.id)}/replace`, file, {}, (fraction) => {
      replaceProgress.value = Math.round(fraction * 100)
    }).done
    changed.value = true
    report.value = t('media.details.replaced')
    await load()
  } catch (caught) {
    failure.value = errorText(caught)
  } finally {
    replacing.value = false
  }
}

// --- Edit, regenerate, delete ----------------------------------------------------------------------------------------------------------
const editorDialog = overlay.create(MediaImageEditor)
async function openEditor(): Promise<void> {
  const current = item.value
  if (!current) return
  const saved = await editorDialog.open({
    item: current,
    save: async (operations) => {
      try {
        await mediaApi.edit(current.id, operations)
        return undefined
      } catch (caught) {
        return errorText(caught)
      }
    },
  })
  if (saved === true) {
    changed.value = true
    report.value = t('media.details.edited')
    await load()
  }
}

const regenerating = ref(false)
async function regenerate(): Promise<void> {
  const current = item.value
  if (!current || regenerating.value) return
  regenerating.value = true
  failure.value = undefined
  try {
    await mediaApi.regenerate([current.id])
    report.value = t('media.details.regenerating')
    await load()
  } catch (caught) {
    failure.value = errorText(caught)
  } finally {
    regenerating.value = false
  }
}

async function remove(): Promise<void> {
  const current = item.value
  if (!current) return
  const used = current.usedBy.length + current.usedByOthers
  // The titles the account may read, then the rest as a number (the api never sends their titles).
  const others = current.usedByOthers
  const names = [
    current.usedBy.map((use) => titleOf(t, use.title)).join(', '),
    others > 0 ? t('media.details.usedByOthers', { n: others }, others) : '',
  ]
    .filter((part) => part !== '')
    .join(' ')
  let description = t('media.details.deleteConfirm')
  if (current.usedBy.length > 0) {
    description = t('media.details.deleteUsed', { n: used, list: names }, used)
  } else if (others > 0) {
    description = t('media.details.deleteUsedHidden', { n: others }, others)
  }
  const confirmed = await confirm.ask({
    title: t('media.details.deleteTitle'),
    description,
    confirmLabel: t('media.details.delete'),
    cancelLabel: t('content.quickEdit.cancel'),
    color: 'error',
  })
  if (!confirmed) return
  try {
    await mediaApi.remove(current.id)
    emit('close', true)
  } catch (caught) {
    failure.value = errorText(caught)
  }
}

const usageLink = (use: MediaDetail['usedBy'][number]) => `/${use.type === 'page' ? 'pages' : 'posts'}/${use.id}`
const facts = computed(() => {
  const current = item.value
  if (!current) return []
  return [
    { label: t('media.details.uploadedOn'), value: formatWhen(current.createdAt, locale.value) },
    ...(current.uploadedBy ? [{ label: t('media.details.uploadedBy'), value: current.uploadedBy.displayName }] : []),
    { label: t('media.details.fileName'), value: current.fileName },
    { label: t('media.details.fileType'), value: current.mime },
    { label: t('media.details.fileSize'), value: formatBytes(current.size) },
    ...(current.width !== null && current.height !== null
      ? [
          {
            label: t('media.details.dimensions'),
            value: t('media.details.pixels', { width: current.width, height: current.height }),
          },
        ]
      : []),
  ]
})
</script>

<template>
  <UModal
    :title="$t('media.details.title')"
    fullscreen
    :ui="{ footer: 'justify-end' }"
    @update:open="emit('close', changed)"
  >
    <template #body>
      <UAlert v-if="loadError" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="loadError" />
      <div v-else-if="item" class="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div class="flex flex-col gap-3">
          <!-- eslint-disable vue/html-self-closing -->
          <img
            v-if="isImage"
            :src="item.url"
            :srcset="srcsetOf(item)"
            sizes="(min-width: 64rem) 60vw, 100vw"
            :alt="item.alt"
            class="h-auto max-h-[70vh] w-auto max-w-full self-start rounded-md object-contain"
          />
          <!-- eslint-enable vue/html-self-closing -->
          <div v-else class="flex items-center gap-3 rounded-md border border-default p-6">
            <UIcon name="i-lucide-file" class="size-10 text-muted" />
            <a :href="item.url" class="text-primary underline underline-offset-4 wrap-anywhere">{{ item.fileName }}</a>
          </div>
          <p v-if="processingLabel($t, item.processing)" class="text-sm text-warning" role="status">
            {{ processingLabel($t, item.processing) }}
          </p>
          <template v-if="item.processing === 'failed'">
            <p v-if="item.processingError" class="text-sm text-toned wrap-anywhere">
              {{ $t('media.processing.reason', { reason: failureText($t, item.processingError) }) }}
            </p>
            <p v-if="isImage && mayManage" class="text-sm text-toned">{{ $t('media.processing.retry') }}</p>
          </template>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-if="isImage && mayEdit"
              icon="i-lucide-crop"
              color="neutral"
              variant="outline"
              class="min-h-11"
              :disabled="item.processing === 'pending'"
              :label="$t('media.details.editImage')"
              @click="openEditor"
            />
            <UButton
              v-if="mayEdit"
              icon="i-lucide-replace"
              color="neutral"
              variant="outline"
              class="min-h-11"
              :loading="replacing"
              :disabled="item.processing === 'pending'"
              :label="$t('media.details.replace')"
              @click="replaceInput?.inputRef?.click()"
            />
            <UInput
              ref="replaceInput"
              type="file"
              class="sr-only"
              tabindex="-1"
              aria-hidden="true"
              :aria-label="$t('media.details.replace')"
              @change="onReplace"
            />
            <UButton
              v-if="isImage && mayManage"
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="outline"
              class="min-h-11"
              :loading="regenerating"
              :label="$t('media.details.regenerate')"
              @click="regenerate"
            />
          </div>
          <UProgress
            v-if="replacing"
            :model-value="replaceProgress"
            :aria-label="$t('media.details.replace')"
            size="sm"
          />

          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <template v-for="fact in facts" :key="fact.label">
              <dt class="font-semibold text-highlighted">{{ fact.label }}</dt>
              <dd class="text-default wrap-anywhere">{{ fact.value }}</dd>
            </template>
          </dl>

          <section :aria-labelledby="`${uid}-used`" class="flex flex-col gap-1">
            <h3 :id="`${uid}-used`" class="font-semibold text-highlighted">{{ $t('media.details.usedBy') }}</h3>
            <ul v-if="item.usedBy.length > 0" class="flex flex-col gap-1 text-sm">
              <li v-for="use in item.usedBy" :key="use.id">
                <NuxtLink :to="usageLink(use)" class="text-primary underline underline-offset-4">{{
                  titleOf($t, use.title)
                }}</NuxtLink>
                <span class="text-toned"> · {{ usageStatus($t, use.status) }}</span>
              </li>
              <li v-if="item.usedByOthers > 0" class="text-toned">
                {{ $t('media.details.usedByOthers', { n: item.usedByOthers }, item.usedByOthers) }}
              </li>
            </ul>
            <p v-else-if="item.usedByOthers > 0" class="text-sm text-toned">
              {{ $t('media.details.usedOnlyByOthers', { n: item.usedByOthers }, item.usedByOthers) }}
            </p>
            <p v-else class="text-sm text-toned">{{ $t('media.details.unused') }}</p>
          </section>
        </div>

        <form :id="`${uid}-form`" class="flex flex-col gap-4" @submit.prevent="save">
          <UFormField
            v-if="isImage"
            :label="$t('media.details.alt')"
            :help="$t('media.details.altHelp')"
            :name="`${uid}-alt`"
          >
            <UTextarea
              v-model="form.alt"
              :rows="2"
              class="w-full"
              :maxlength="MEDIA_TITLE_MAX_LENGTH"
              :disabled="!mayEdit"
            />
          </UFormField>
          <UFormField :label="$t('media.details.fileTitle')" :name="`${uid}-title`">
            <UInput
              v-model="form.fileTitle"
              size="xl"
              class="w-full"
              :maxlength="MEDIA_TITLE_MAX_LENGTH"
              :disabled="!mayEdit"
            />
          </UFormField>
          <UFormField :label="$t('media.details.caption')" :name="`${uid}-caption`">
            <UTextarea
              v-model="form.caption"
              :rows="2"
              class="w-full"
              :maxlength="MEDIA_TEXT_MAX_LENGTH"
              :disabled="!mayEdit"
            />
          </UFormField>
          <UFormField :label="$t('media.details.description')" :name="`${uid}-description`">
            <UTextarea
              v-model="form.about"
              :rows="3"
              class="w-full"
              :maxlength="MEDIA_TEXT_MAX_LENGTH"
              :disabled="!mayEdit"
            />
          </UFormField>
          <UFormField
            :label="$t('media.details.visibility')"
            :help="$t('media.details.visibilityHelp')"
            :name="`${uid}-visibility`"
          >
            <USelect v-model="form.visibility" :items="visibilityItems" size="xl" class="w-full" :disabled="!mayEdit" />
          </UFormField>
          <UFormField :label="$t('media.folders.folder')" :name="`${uid}-folder`">
            <USelect v-model="form.folder" :items="folderItems" size="xl" class="w-full" :disabled="!mayEdit" />
          </UFormField>
          <UFormField :label="$t('media.details.fileUrl')" :name="`${uid}-url`">
            <div class="flex flex-wrap gap-2">
              <UInput :model-value="absoluteUrl" readonly size="xl" class="min-w-0 flex-1" />
              <UButton color="neutral" variant="outline" size="lg" class="min-h-11" @click="copyUrl">
                {{ copied ? $t('media.details.copied') : $t('media.details.copyUrl') }}
              </UButton>
            </div>
          </UFormField>
          <div role="status">
            <UAlert v-if="report" color="success" variant="subtle" icon="i-lucide-circle-check" :title="report" />
          </div>
          <UAlert
            v-if="failure"
            color="error"
            variant="subtle"
            role="alert"
            icon="i-lucide-triangle-alert"
            :title="$t('content.actionFailed')"
            :description="failure"
          />
        </form>
      </div>
    </template>
    <template #footer>
      <UButton
        v-if="item?.can.delete"
        color="error"
        variant="ghost"
        size="lg"
        class="me-auto min-h-11"
        :label="$t('media.details.delete')"
        @click="remove"
      />
      <UButton color="neutral" variant="outline" size="lg" class="min-h-11" @click="emit('close', changed)">
        {{ $t('media.details.close') }}
      </UButton>
      <UButton v-if="mayEdit" type="submit" :form="`${uid}-form`" size="lg" class="min-h-11" :loading="saving">
        {{ $t('media.details.save') }}
      </UButton>
    </template>
  </UModal>
</template>
