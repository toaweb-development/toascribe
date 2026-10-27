<script setup lang="ts">
// The frame of a settings screen (M1.5): the title, the refusal for an account without `manage_options`, a failed load, and around
// the fields the save button and what the save said. The fields are the slot.
defineProps<{
  id: string
  title: string
  mayManage: boolean
  loaded: boolean
  failed: boolean
  saving: boolean
  report?: string | undefined
  failure?: string | undefined
}>()
const emit = defineEmits<{ save: []; retry: [] }>()
</script>

<template>
  <UDashboardPanel :id="id">
    <template #header>
      <UDashboardNavbar :title="title" />
    </template>
    <template #body>
      <section v-if="!mayManage" :aria-labelledby="`${id}-denied`" class="flex max-w-prose flex-col gap-3">
        <h2 :id="`${id}-denied`" class="text-xl font-semibold text-highlighted">{{ $t('settings.denied') }}</h2>
        <p class="text-base text-default">{{ $t('content.denied.text') }}</p>
      </section>
      <UAlert
        v-else-if="failed"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :title="$t('settings.loadFailed')"
        :actions="[{ label: $t('content.failed.retry'), onClick: () => emit('retry') }]"
      />
      <form v-else-if="loaded" class="flex max-w-3xl flex-col gap-8" @submit.prevent="emit('save')">
        <slot />
        <div role="status">
          <UAlert v-if="report" color="success" variant="subtle" icon="i-lucide-circle-check" :title="report" />
        </div>
        <UAlert
          v-if="failure"
          color="error"
          variant="subtle"
          role="alert"
          icon="i-lucide-triangle-alert"
          :title="$t('settings.saveFailed')"
          :description="failure"
        />
        <div>
          <UButton type="submit" size="lg" class="min-h-11" :loading="saving">{{ $t('settings.save') }}</UButton>
        </div>
      </form>
    </template>
  </UDashboardPanel>
</template>
