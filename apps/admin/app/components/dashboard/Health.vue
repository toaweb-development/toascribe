<script setup lang="ts">
// «Nettstedshelse-status» (M1.8, K-033; WordPress' Site Health Status widget), as «Blekk» draws it (M2.1): the api's checks summed up
// as good, «bør forbedres» or «bør fikses» in a badge, a bar with a segment per check, coloured where it is not good, each check that is not good in a line, and a
// link to «Verktøy → Nettstedshelse». For `manage_options`, as the api asks.
const { t } = useI18n()
const siteTools = useSiteToolsApi()
const { data, status, error, refresh } = await useAsyncData('dashboard:health', () => siteTools.healthStatus())

const issues = computed(() => data.value?.tests.filter((test) => test.status !== 'good') ?? [])
const overall = computed(() =>
  issues.value.some((test) => test.status === 'critical')
    ? 'critical'
    : issues.value.length > 0
      ? 'recommended'
      : 'good',
)
const color = { good: 'success', recommended: 'warning', critical: 'error' } as const
const bar = { good: 'bg-success-text', recommended: 'bg-warning-dot', critical: 'bg-danger' } as const
</script>

<template>
  <UCard as="section" aria-labelledby="health-heading" :aria-busy="status === 'pending'">
    <template #header>
      <div class="flex items-center justify-between gap-3">
        <h2 id="health-heading" class="text-card-title font-semibold text-heading">
          {{ $t('dashboard.health.heading') }}
        </h2>
        <UBadge v-if="data" :color="color[overall]" variant="subtle" class="rounded-full">
          {{ HEALTH_OVERALL[overall](t) }}
        </UBadge>
      </div>
    </template>

    <div v-if="data" class="flex flex-col gap-3">
      <div class="flex items-center gap-3">
        <!-- One segment per check, so no inline style is needed (the admin's CSP takes no style attribute it does not know). -->
        <div class="flex flex-1 gap-1" aria-hidden="true">
          <span
            v-for="test in data.tests"
            :key="test.key"
            class="h-1.5 flex-1 rounded-full"
            :class="test.status === 'good' ? 'bg-sunken' : bar[test.status]"
          />
        </div>
        <p class="shrink-0 font-mono text-help text-secondary">{{ $t('dashboard.health.toCheck', issues.length) }}</p>
      </div>
      <ul v-if="issues.length > 0" class="flex flex-col gap-1">
        <li v-for="test in issues" :key="test.key" class="text-body text-heading">
          <span class="sr-only">{{ HEALTH_OVERALL[test.status](t) }}: </span>
          {{ HEALTH_TESTS[test.key][test.status === 'critical' ? 'critical' : 'recommended'](t) }}
        </li>
      </ul>
      <ULink
        to="/tools/site-health"
        class="inline-flex min-h-control items-center self-start font-medium text-accent-text hover:underline"
      >
        {{ $t('dashboard.health.more') }}
      </ULink>
    </div>

    <USkeleton v-else-if="status === 'pending'" role="presentation" aria-hidden="true" aria-label="" class="h-5 w-40" />

    <UAlert v-else-if="error" color="error" variant="subtle" role="alert" :title="$t('dashboard.health.failed.title')">
      <template #description>
        <p>{{ $t('dashboard.health.failed.text') }}</p>
      </template>
      <template #actions>
        <UButton color="neutral" variant="outline" size="lg" class="min-h-control" @click="() => refresh()">
          {{ $t('dashboard.health.failed.retry') }}
        </UButton>
      </template>
    </UAlert>
  </UCard>
</template>
