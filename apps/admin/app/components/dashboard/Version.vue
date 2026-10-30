<script setup lang="ts">
// «Versjon» (M2.1, «Blekk»): the version that runs, whether it is the newest the last update check found (for `update_core`, as
// «Oppdateringer» needs; others see the version only), and a link to the changelog of that version. The version comes from the
// glance the dashboard loads.
const props = defineProps<{ version: string | undefined }>()

const auth = useAuth()
const siteTools = useSiteToolsApi()
const mayUpdate = computed(
  () =>
    auth.session.value.status === 'authenticated' && auth.session.value.account.capabilities.includes('update_core'),
)
// A failed check is only a shorter text here: «Oppdateringer» says what went wrong.
const { data } = await useAsyncData('dashboard:updates', () => siteTools.updates().catch(() => null), {
  enabled: mayUpdate,
})

const check = computed(() => (data.value?.status?.ok === true ? data.value.status : undefined))
const changelog = computed(() => (props.version === undefined ? undefined : changelogUrl(props.version)))
</script>

<template>
  <UCard as="section" aria-labelledby="version-heading">
    <template #header>
      <h2 id="version-heading" class="text-card-title font-semibold text-heading">
        {{ $t('dashboard.version.heading') }}
      </h2>
    </template>

    <div v-if="props.version" class="flex flex-col gap-2">
      <i18n-t v-if="check?.available" keypath="dashboard.version.behind" tag="p" class="text-body text-heading">
        <template #version>
          <span class="font-mono">{{ props.version }}</span>
        </template>
        <template #latest>
          <span class="font-mono">{{ check?.latest }}</span>
        </template>
      </i18n-t>
      <i18n-t v-else-if="check?.latest" keypath="dashboard.version.newest" tag="p" class="text-body text-heading">
        <template #version>
          <span class="font-mono">{{ props.version }}</span>
        </template>
      </i18n-t>
      <i18n-t v-else keypath="dashboard.version.running" tag="p" class="text-body text-heading">
        <template #version>
          <span class="font-mono">{{ props.version }}</span>
        </template>
      </i18n-t>
      <ULink
        v-if="check?.available"
        to="/updates"
        class="inline-flex min-h-control items-center self-start font-medium text-accent-text hover:underline"
      >
        {{ $t('dashboard.version.update') }}
      </ULink>
      <ULink
        v-else
        :to="changelog"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex min-h-control items-center self-start font-medium text-accent-text hover:underline"
      >
        {{ $t('dashboard.version.changelog') }}<span class="sr-only"> {{ $t('shell.newTab') }}</span>
      </ULink>
    </div>
    <USkeleton v-else role="presentation" aria-hidden="true" aria-label="" class="h-5 w-40" />
  </UCard>
</template>
