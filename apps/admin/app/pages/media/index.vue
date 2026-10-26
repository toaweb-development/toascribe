<script setup lang="ts">
// «Media → Bibliotek» (M1.2; WordPress' upload.php). Needs `upload_files`, as in WordPress.
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t } = useI18n()
const auth = useAuth()
useSeoMeta({ title: () => t('media.library.title') })

const mayUpload = computed(
  () =>
    auth.session.value.status === 'authenticated' && auth.session.value.account.capabilities.includes('upload_files'),
)
if (import.meta.server && !mayUpload.value) {
  const event = useRequestEvent()
  if (event) setResponseStatus(event, 403)
}
</script>

<template>
  <UDashboardPanel id="media-library">
    <template #header>
      <UDashboardNavbar :title="$t('media.library.title')" />
    </template>
    <template #body>
      <section v-if="!mayUpload" aria-labelledby="media-denied-heading" class="flex max-w-prose flex-col gap-3">
        <h2 id="media-denied-heading" class="text-xl font-semibold text-highlighted">{{ $t('media.denied') }}</h2>
        <p class="text-base text-default">{{ $t('content.denied.text') }}</p>
      </section>
      <MediaLibrary v-else />
    </template>
  </UDashboardPanel>
</template>
