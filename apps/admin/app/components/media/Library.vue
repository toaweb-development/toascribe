<script setup lang="ts">
import { MEDIA_GROUPS } from '@toascribe/shared'
import type { MediaGroup, MediaItem, MediaListResponse } from '@toascribe/shared'
import { MediaDetails, MediaFolders } from '#components'

// The media library (K-110, K-112, K-119; WordPress' upload.php): the files as a grid of thumbnails or as a list, filtered by type, month
// and folder, with search, «Legg til mediefil» (the uploader above the grid, as in WordPress) and the folders. On the page a file opens
// «Vedleggsdetaljer»; in the editor's picker (`picker`) a file is chosen instead, and an upload is chosen as it arrives.
const props = defineProps<{
  /** Choose a file instead of opening its details (the editor's picker). */
  picker?: boolean
  /** Only this type, without the type filter (the picker's images). */
  group?: MediaGroup
  /** The id chosen in the picker. */
  chosen?: string
}>()
const emit = defineEmits<{ pick: [item: MediaItem] }>()

const { t, locale } = useI18n()
const auth = useAuth()
const mediaApi = useMediaApi()
const overlay = useOverlay()
const uid = useId()

const capabilities = computed(() =>
  auth.session.value.status === 'authenticated' ? auth.session.value.account.capabilities : [],
)
const mayUpload = computed(() => capabilities.value.includes('upload_files'))
const mayManage = computed(() => capabilities.value.includes('manage_options'))
// Renaming, moving and deleting folders needs edit_others_posts (they hold other people's files); making one only upload_files.
const mayOrganize = computed(() => capabilities.value.includes('edit_others_posts'))

const ALL = 'all'
const filters = reactive({ search: '', group: props.group ?? ALL, month: ALL, folder: ALL, page: 1 })
const searchText = ref('')
const view = ref<'grid' | 'list'>('grid')
const PER_PAGE = 40

const { data, status, error, refresh } = await useAsyncData(
  `media:library:${props.picker === true ? 'picker' : 'page'}`,
  async (): Promise<MediaListResponse | null> =>
    mayUpload.value
      ? await mediaApi.list({
          ...(filters.search === '' ? {} : { search: filters.search }),
          ...(filters.group === ALL ? {} : { group: filters.group as MediaGroup }),
          ...(filters.month === ALL ? {} : { month: filters.month }),
          ...(filters.folder === ALL ? {} : { folder: filters.folder }),
          page: filters.page,
          per_page: PER_PAGE,
        })
      : null,
  { watch: [filters], server: props.picker !== true },
)
const { data: folderData, refresh: refreshFolders } = await useAsyncData(
  `media:folders:${props.picker === true ? 'picker' : 'page'}`,
  async () => (mayUpload.value ? (await mediaApi.folders()).folders : []),
  { server: props.picker !== true },
)
const folders = computed(() => folderData.value ?? [])
const items = computed(() => data.value?.items ?? [])

// A file whose sizes the worker is still making shows «Bildestørrelsene lages …»: the list asks again every three seconds while one is
// shown, for at most two minutes, so the thumbnail appears without a reload.
let polls = 0
let timer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(timer))
watch(
  items,
  (rows) => {
    clearTimeout(timer)
    if (!import.meta.client) return
    if (!rows.some((row) => row.processing === 'pending')) {
      polls = 0
      return
    }
    if (polls < 40) {
      polls += 1
      timer = setTimeout(() => void refresh(), 3000)
    }
  },
  { immediate: true },
)

const groupItems = computed(() => [
  { value: ALL, label: t('media.filters.allTypes') },
  ...MEDIA_GROUPS.map((group) => ({ value: group, label: groupLabel(t, group) })),
])
const monthItems = computed(() => [
  { value: ALL, label: t('content.filter.allMonths') },
  ...(data.value?.months ?? []).map((month) => ({ value: month, label: monthLabel(month, locale.value) })),
])
const folderItems = computed(() => [
  { value: ALL, label: t('media.folders.all') },
  { value: 'none', label: t('media.folders.none') },
  ...folders.value.map((folder) => ({ value: folder.id, label: `${'   '.repeat(folder.depth)}${folder.name}` })),
])
watch(
  () => [filters.group, filters.month, filters.folder, filters.search],
  () => {
    filters.page = 1
  },
)

const showUploader = ref(false)
function onUploaded(item: MediaItem): void {
  void refresh()
  void refreshFolders()
  if (props.picker === true) emit('pick', item)
}

/** The smallest size that fills a grid cell, or the shown image. */
function thumbOf(item: MediaItem): string {
  return (
    item.sizes.find((size) => size.name === 'thumbnail')?.url ??
    item.sizes.find((size) => size.width >= 150)?.url ??
    item.url
  )
}
const labelOf = (item: MediaItem) => (item.title.trim() === '' ? item.fileName : item.title)

const detailsDialog = overlay.create(MediaDetails)
async function open(item: MediaItem): Promise<void> {
  if (props.picker === true) {
    emit('pick', item)
    return
  }
  const changed = await detailsDialog.open({ id: item.id, folders: folders.value, mayManage: mayManage.value })
  if (changed === true) await Promise.all([refresh(), refreshFolders()])
}

const foldersDialog = overlay.create(MediaFolders)
async function manageFolders(): Promise<void> {
  const changed = await foldersDialog.open({ folders: folders.value, mayOrganize: mayOrganize.value })
  if (changed === true) await Promise.all([refresh(), refreshFolders()])
}

const PAGE_BUTTON = 'min-h-control min-w-control'
const headClass = 'px-3 py-2 text-start text-badge font-semibold tracking-wide text-secondary uppercase'
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        icon="i-lucide-upload"
        size="lg"
        class="min-h-control"
        :aria-expanded="showUploader"
        :aria-controls="`${uid}-uploader`"
        :label="$t('media.library.addNew')"
        @click="showUploader = !showUploader"
      />
      <UButton
        v-if="!picker"
        icon="i-lucide-folder"
        color="neutral"
        variant="outline"
        size="lg"
        class="min-h-control"
        :label="$t('media.folders.manage')"
        @click="manageFolders"
      />
    </div>

    <div v-if="showUploader && data" :id="`${uid}-uploader`">
      <MediaUploader
        :limits="data.upload"
        :folder-id="filters.folder === ALL || filters.folder === 'none' ? null : filters.folder"
        :images-only="group === 'image'"
        @uploaded="onUploaded"
      />
    </div>

    <div class="flex flex-wrap items-start gap-2" role="group" :aria-label="$t('media.filters.label')">
      <div class="flex gap-1" role="group" :aria-label="$t('media.library.view')">
        <UButton
          icon="i-lucide-layout-grid"
          :color="view === 'grid' ? 'primary' : 'neutral'"
          :variant="view === 'grid' ? 'soft' : 'ghost'"
          class="min-h-control min-w-control"
          :aria-pressed="view === 'grid'"
          :aria-label="$t('media.library.grid')"
          @click="view = 'grid'"
        />
        <UButton
          icon="i-lucide-list"
          :color="view === 'list' ? 'primary' : 'neutral'"
          :variant="view === 'list' ? 'soft' : 'ghost'"
          class="min-h-control min-w-control"
          :aria-pressed="view === 'list'"
          :aria-label="$t('media.library.list')"
          @click="view = 'list'"
        />
      </div>
      <UFormField
        v-if="group === undefined"
        :label="$t('media.filters.type')"
        :name="`${uid}-group`"
        :ui="{ label: 'sr-only' }"
      >
        <USelect v-model="filters.group" :items="groupItems" class="w-full sm:w-44" />
      </UFormField>
      <UFormField :label="$t('media.filters.date')" :name="`${uid}-month`" :ui="{ label: 'sr-only' }">
        <USelect v-model="filters.month" :items="monthItems" class="w-full sm:w-44" />
      </UFormField>
      <UFormField :label="$t('media.folders.folder')" :name="`${uid}-folder`" :ui="{ label: 'sr-only' }">
        <USelect v-model="filters.folder" :items="folderItems" class="w-full sm:w-44" />
      </UFormField>
      <form
        role="search"
        class="flex flex-wrap items-start gap-2 sm:ms-auto"
        @submit.prevent="filters.search = searchText.trim()"
      >
        <UFormField :label="$t('media.library.search')" :name="`${uid}-search`" :ui="{ label: 'sr-only' }">
          <UInput
            v-model="searchText"
            type="search"
            autocomplete="off"
            icon="i-lucide-search"
            :placeholder="$t('media.library.search')"
          />
        </UFormField>
        <UButton type="submit" color="neutral" variant="outline">
          {{ $t('media.library.search') }}
        </UButton>
      </form>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="$t('media.library.loadFailed')"
      :actions="[{ label: $t('content.failed.retry'), onClick: () => refresh() }]"
    />
    <p v-if="data" role="status" class="text-help text-secondary">
      {{ $t('media.library.count', { n: data.total }, data.total) }}
    </p>
    <BlekkEmptyState v-if="data && items.length === 0" icon="i-lucide-image" :title="$t('media.library.empty')" />

    <ul
      v-else-if="data && view === 'grid'"
      class="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8"
      :class="status === 'pending' ? 'opacity-60' : ''"
      :aria-label="$t('media.library.items')"
    >
      <li v-for="item in items" :key="item.id">
        <button
          type="button"
          data-testid="media-item"
          class="group relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-menu border bg-sunken"
          :class="chosen === item.id ? 'border-accent ring-2 ring-accent' : 'border-line'"
          :aria-pressed="picker ? chosen === item.id : undefined"
          @click="open(item)"
        >
          <!-- The name is the file's title, then what the tile shows in words (WCAG 2.5.3: the visible text is part of the name). -->
          <span v-if="item.group === 'image' && item.processing !== 'failed'" class="sr-only">{{ labelOf(item) }}</span>
          <span v-else-if="labelOf(item) !== item.fileName" class="sr-only">{{ labelOf(item) }}</span>
          <!-- eslint-disable vue/html-self-closing -->
          <img
            v-if="item.group === 'image' && item.processing !== 'failed'"
            :src="thumbOf(item)"
            alt=""
            class="size-full object-cover"
            loading="lazy"
            decoding="async"
          />
          <!-- eslint-enable vue/html-self-closing -->
          <span v-else class="flex flex-col items-center gap-1 p-2 text-center">
            <UIcon name="i-lucide-file" class="size-8 text-muted" />
            <span class="line-clamp-2 text-badge text-default wrap-anywhere">{{ item.fileName }}</span>
          </span>
          <span
            v-if="item.processing === 'pending'"
            class="absolute inset-x-0 bottom-0 bg-default/80 px-1 py-0.5 text-badge text-secondary"
          >
            {{ $t('media.processing.pending') }}
          </span>
          <span
            v-else-if="item.processing === 'failed'"
            class="absolute inset-x-0 bottom-0 bg-default/80 px-1 py-0.5 text-badge text-error"
          >
            {{ $t('media.processing.failedShort') }}
          </span>
          <UIcon
            v-if="item.visibility === 'private'"
            name="i-lucide-lock"
            class="absolute end-1 top-1 size-4 text-heading"
            :aria-label="$t('media.details.private')"
          />
        </button>
      </li>
    </ul>

    <div v-else-if="data" :class="status === 'pending' ? 'opacity-60' : ''">
      <BlekkTableFrame :label="$t('media.library.items')">
        <table class="w-full min-w-160 table-auto text-start text-body">
          <caption class="sr-only">
            {{
              $t('media.library.items')
            }}
          </caption>
          <thead>
            <tr class="border-b border-line">
              <th scope="col" :class="headClass">{{ $t('media.columns.file') }}</th>
              <th scope="col" :class="headClass">{{ $t('media.columns.author') }}</th>
              <th scope="col" :class="[headClass, 'text-end']">{{ $t('media.columns.size') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-divider">
            <tr v-for="item in items" :key="item.id" class="hover:bg-sunken">
              <th scope="row" class="px-3 py-2 text-start align-middle font-normal">
                <span class="flex items-center gap-3">
                  <span
                    class="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-menu bg-sunken"
                  >
                    <!-- eslint-disable vue/html-self-closing -->
                    <img
                      v-if="item.group === 'image' && item.processing !== 'failed'"
                      :src="thumbOf(item)"
                      alt=""
                      class="size-full object-cover"
                      loading="lazy"
                    />
                    <!-- eslint-enable vue/html-self-closing -->
                    <UIcon v-else name="i-lucide-file" class="size-6 text-secondary" />
                  </span>
                  <span class="flex min-w-0 flex-col">
                    <button
                      type="button"
                      class="inline-flex min-h-control items-center self-start text-start font-semibold text-heading hover:underline wrap-anywhere"
                      :aria-pressed="picker ? chosen === item.id : undefined"
                      @click="open(item)"
                    >
                      {{ labelOf(item) }}
                    </button>
                    <span class="font-mono text-help text-secondary wrap-anywhere">{{ item.fileName }}</span>
                    <span
                      v-if="item.visibility === 'private' || processingLabel($t, item.processing)"
                      class="text-help text-secondary"
                    >
                      <template v-if="item.visibility === 'private'">{{ $t('media.details.private') }}</template>
                      <template v-if="processingLabel($t, item.processing)">
                        {{ item.visibility === 'private' ? ' · ' : ''
                        }}{{ processingLabel($t, item.processing) }}</template
                      >
                      <template v-if="item.processing === 'failed' && item.processingError">
                        {{ $t('media.processing.reason', { reason: failureText($t, item.processingError) }) }}</template
                      >
                    </span>
                  </span>
                </span>
              </th>
              <td class="px-3 py-2 align-middle text-heading">{{ item.uploadedBy?.displayName ?? '—' }}</td>
              <td class="px-3 py-2 text-end align-middle font-mono text-help text-heading whitespace-nowrap">
                {{ formatBytes(item.size, locale) }}
              </td>
            </tr>
          </tbody>
        </table>
      </BlekkTableFrame>
    </div>

    <UPagination
      v-if="data && data.totalPages > 1"
      v-model:page="filters.page"
      as="nav"
      :aria-label="$t('content.pagination')"
      :total="data.total"
      :items-per-page="data.perPage"
      :sibling-count="1"
      show-edges
      :ui="{
        list: 'flex-wrap',
        item: PAGE_BUTTON,
        prev: PAGE_BUTTON,
        next: PAGE_BUTTON,
        first: PAGE_BUTTON,
        last: PAGE_BUTTON,
      }"
    />
  </div>
</template>
