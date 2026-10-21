<script setup lang="ts">
import type { HealthResponse } from '@toascribe/shared'

defineProps<{
  /** The API's answer, when there was one. */
  health: HealthResponse | undefined
  /** True when the API could not be reached or answered wrongly. */
  failed: boolean
  /** True while a new check runs. */
  pending: boolean
}>()

defineEmits<{ retry: [] }>()
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="text-base font-semibold text-highlighted">{{ $t('apiStatus.title') }}</h2>
    </template>

    <div role="status" class="flex flex-wrap items-center gap-3">
      <template v-if="health">
        <UBadge color="success" variant="subtle" size="lg">{{ $t('apiStatus.ok.badge') }}</UBadge>
        <span class="text-base">{{ $t('apiStatus.ok.text', { version: health.version }) }}</span>
      </template>
      <template v-else-if="failed">
        <UBadge color="error" variant="subtle" size="lg">{{ $t('apiStatus.failed.badge') }}</UBadge>
        <span class="text-base">{{ $t('apiStatus.failed.text') }}</span>
      </template>
      <template v-else>
        <UBadge color="neutral" variant="subtle" size="lg">{{ $t('apiStatus.checking.badge') }}</UBadge>
        <span class="text-base">{{ $t('apiStatus.checking.text') }}</span>
      </template>
    </div>

    <template v-if="failed" #footer>
      <UButton color="neutral" variant="outline" size="xl" class="min-h-11" :loading="pending" @click="$emit('retry')">
        {{ $t('apiStatus.retry') }}
      </UButton>
    </template>
  </UCard>
</template>
