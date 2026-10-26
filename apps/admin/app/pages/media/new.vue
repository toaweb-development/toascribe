<script setup lang="ts">
import type { MediaItem } from '@toascribe/shared'
import { MediaDetails } from '#components'

// «Media → Legg til ny» (M1.2; WordPress' media-new.php): the uploader on its own page, and the files uploaded here, each with «Rediger».
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t } = useI18n()
const auth = useAuth()
const mediaApi = useMediaApi()
const overlay = useOverlay()
useSeoMeta({ title: () => t('media.new.title') })

const capabilities = computed(() =>
  auth.session.value.status === 'authenticated' ? auth.session.value.account.capabilities : [],
)
const mayUpload = computed(() => capabilities.value.includes('upload_files'))
if (import.meta.server && !mayUpload.value) {
  const event = useRequestEvent()
  if (event) setResponseStatus(event, 403)
}

// The limits for this account come with the list answer; one file is enough to ask.
const { data, error, refresh } = await useAsyncData('media:new:limits', async () =>
  mayUpload.value ? (await mediaApi.list({ per_page: 1 })).upload : null,
)

const uploaded = ref<MediaItem[]>([])
const detailsDialog = overlay.create(MediaDetails)
async function edit(item: MediaItem): Promise<void> {
  const folders = (await mediaApi.folders()).folders
  await detailsDialog.open({ id: item.id, folders, mayManage: capabilities.value.includes('manage_options') })
}
</script>

<template>
  <UDashboardPanel id="media-new">
    <template #header>
      <UDashboardNavbar :title="$t('media.new.title')" />
    </template>
    <template #body>
      <section v-if="!mayUpload" aria-labelledby="media-denied-heading" class="flex max-w-prose flex-col gap-3">
        <h2 id="media-denied-heading" class="text-xl font-semibold text-highlighted">{{ $t('media.denied') }}</h2>
        <p class="text-base text-default">{{ $t('content.denied.text') }}</p>
      </section>
      <div v-else class="flex max-w-3xl flex-col gap-6">
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="$t('media.library.loadFailed')"
          :actions="[{ label: $t('content.failed.retry'), onClick: () => refresh() }]"
        />
        <MediaUploader v-if="data" :limits="data" @uploaded="uploaded.unshift($event)" />
        <section v-if="uploaded.length > 0" aria-labelledby="media-new-done" class="flex flex-col gap-2">
          <h2 id="media-new-done" class="text-lg font-semibold text-highlighted">{{ $t('media.new.uploaded') }}</h2>
          <ul class="flex flex-col divide-y divide-default rounded-md border border-default">
            <li v-for="item in uploaded" :key="item.id" class="flex items-center justify-between gap-3 p-2">
              <span class="min-w-0 truncate text-sm text-highlighted">{{ item.title || item.fileName }}</span>
              <UButton
                size="sm"
                color="neutral"
                variant="ghost"
                class="min-h-11 lg:min-h-8"
                :label="$t('content.actions.edit')"
                :aria-label="$t('media.new.editNamed', { name: item.title || item.fileName })"
                @click="edit(item)"
              />
            </li>
          </ul>
        </section>
      </div>
    </template>
  </UDashboardPanel>
</template>
