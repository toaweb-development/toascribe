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
      <h2 class="text-base font-semibold text-highlighted">API-status</h2>
    </template>

    <div role="status" class="flex flex-wrap items-center gap-3">
      <template v-if="health">
        <UBadge color="success" variant="subtle" size="lg">OK</UBadge>
        <span class="text-base">API-et svarer. Versjon {{ health.version }}.</span>
      </template>
      <template v-else-if="failed">
        <UBadge color="error" variant="subtle" size="lg">Utilgjengelig</UBadge>
        <span class="text-base">Får ikke kontakt med API-et.</span>
      </template>
      <template v-else>
        <UBadge color="neutral" variant="subtle" size="lg">Sjekker</UBadge>
        <span class="text-base">Sjekker om API-et svarer.</span>
      </template>
    </div>

    <template v-if="failed" #footer>
      <UButton color="neutral" variant="outline" size="xl" class="min-h-11" :loading="pending" @click="$emit('retry')">
        Prøv igjen
      </UButton>
    </template>
  </UCard>
</template>
