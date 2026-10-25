<script setup lang="ts">
// «I korte trekk» (WordPress' At a Glance): the counts the api gives this account and the version. A count the account may not see
// is not in the answer, and nothing is drawn for it (not a 0). The counts are plain text: the lists they would link to come later.
const adminApi = useAdminApi()
const { data, status, error, refresh } = await useAsyncData('dashboard:glance', () => adminApi.glance())
</script>

<template>
  <UCard as="section" aria-labelledby="glance-heading" :aria-busy="status === 'pending'">
    <template #header>
      <h2 id="glance-heading" class="text-lg font-semibold text-highlighted">{{ $t('dashboard.glance.heading') }}</h2>
    </template>

    <ul v-if="data" class="grid grid-cols-1 gap-x-6 gap-y-1 text-base text-default sm:grid-cols-2">
      <li v-if="data.posts !== undefined">{{ $t('dashboard.glance.posts', data.posts) }}</li>
      <li v-if="data.pages !== undefined">{{ $t('dashboard.glance.pages', data.pages) }}</li>
      <li v-if="data.comments !== undefined">{{ $t('dashboard.glance.comments', data.comments.approved) }}</li>
      <li v-if="data.comments !== undefined">{{ $t('dashboard.glance.pending', { n: data.comments.pending }) }}</li>
      <li class="text-toned sm:col-span-2">{{ $t('dashboard.glance.version', { version: data.version }) }}</li>
    </ul>

    <div v-else-if="status === 'pending'" class="flex flex-col gap-2" aria-hidden="true">
      <USkeleton role="presentation" aria-hidden="true" aria-label="" class="h-5 w-40" />
      <USkeleton role="presentation" aria-hidden="true" aria-label="" class="h-5 w-32" />
    </div>

    <UAlert v-else-if="error" color="error" variant="subtle" role="alert" :title="$t('dashboard.glance.failed.title')">
      <template #description>
        <p>{{ $t('dashboard.glance.failed.text') }}</p>
      </template>
      <template #actions>
        <UButton color="neutral" variant="outline" size="lg" class="min-h-11" @click="() => refresh()">
          {{ $t('dashboard.glance.failed.retry') }}
        </UButton>
      </template>
    </UAlert>
  </UCard>
</template>
