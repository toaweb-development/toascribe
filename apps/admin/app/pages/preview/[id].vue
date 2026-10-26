<script setup lang="ts">
// «Forhåndsvis» (M1.1): an item as the server draws it from its blocks, without the editor and without script of its own. The theme
// renders the real page from M1.4; until then this shows that the stored blocks are enough to draw it. Items from the install hold
// WordPress' parsed blocks until the data migration of M1.3 and are not drawn here.
import { validateDocument } from '@toascribe/blocks'

definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t } = useI18n()
const route = useRoute()
const contentApi = useContentApi()
const id = computed(() => String(route.params.id))

const { data, status, error } = await useAsyncData(`content:preview:${id.value}`, () => contentApi.get(id.value))
useSeoMeta({ title: () => t('content.preview.title', { title: titleOf(t, data.value?.title ?? '') }) })

const drawable = computed(() => (data.value ? validateDocument(data.value.blocks).ok : false))
const backPath = computed(() =>
  data.value ? `/${data.value.type === 'page' ? 'pages' : 'posts'}/${data.value.id}` : '/',
)
</script>

<template>
  <UDashboardPanel id="content-preview">
    <template #header>
      <UDashboardNavbar :title="$t('content.preview.heading')" />
    </template>
    <template #body>
      <div class="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <UAlert
          v-if="error || (status !== 'pending' && !data)"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="$t('content.errors.notFound')"
        />
        <template v-else-if="data">
          <div>
            <UButton
              v-if="data.can.edit"
              :to="backPath"
              icon="i-lucide-arrow-left"
              color="neutral"
              variant="outline"
              :label="$t('content.preview.back')"
            />
          </div>
          <article
            data-testid="content-preview"
            class="flex flex-col gap-4 rounded-md border border-default p-4 sm:p-6"
          >
            <h2 class="text-2xl font-semibold text-highlighted">{{ titleOf($t, data.title) }}</h2>
            <BlocksDocument v-if="drawable" :blocks="data.blocks" :media="data.media" />
            <p v-else class="text-muted">{{ $t('content.editor.legacy') }}</p>
          </article>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
