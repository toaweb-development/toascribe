<script setup lang="ts">
// «Nettstedshelse-status» (M1.8, K-033; WordPress' Site Health Status widget): the api's checks summed up as good, «bør forbedres» or
// «bør fikses», each check that is not good in a line, and a link to «Verktøy → Nettstedshelse». For `manage_options`, as the api asks.
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
const color = computed(() => ({ good: 'success', recommended: 'warning', critical: 'error' }) as const)
</script>

<template>
  <UCard as="section" aria-labelledby="health-heading" :aria-busy="status === 'pending'">
    <template #header>
      <h2 id="health-heading" class="text-lg font-semibold text-highlighted">{{ $t('dashboard.health.heading') }}</h2>
    </template>

    <div v-if="data" class="flex flex-col gap-3">
      <p class="flex items-center gap-2 text-base text-default">
        <UBadge :color="color[overall]" variant="subtle" size="lg">{{
          $t(`dashboard.health.overall.${overall}`)
        }}</UBadge>
      </p>
      <p class="text-base text-default">{{ $t(`dashboard.health.summary.${overall}`, { n: issues.length }) }}</p>
      <ul v-if="issues.length > 0" class="flex flex-col gap-1">
        <li v-for="test in issues" :key="test.key" class="flex items-start gap-2 text-base text-default">
          <UIcon
            :name="test.status === 'critical' ? 'i-lucide-circle-x' : 'i-lucide-triangle-alert'"
            :class="test.status === 'critical' ? 'text-error' : 'text-warning'"
            class="mt-1 size-4 shrink-0"
            aria-hidden="true"
          />
          <span>
            <span class="sr-only">{{ $t(`dashboard.health.overall.${test.status}`) }}: </span>
            {{ $t(`dashboard.health.tests.${test.key}.${test.status}`) }}
          </span>
        </li>
      </ul>
      <ULink
        to="/tools/site-health"
        class="inline-flex min-h-11 items-center text-primary underline underline-offset-4 hover:no-underline lg:min-h-8"
      >
        {{ $t('dashboard.health.more') }}
      </ULink>
    </div>

    <div v-else-if="status === 'pending'" class="flex flex-col gap-2" aria-hidden="true">
      <USkeleton role="presentation" aria-hidden="true" aria-label="" class="h-5 w-40" />
    </div>

    <UAlert v-else-if="error" color="error" variant="subtle" role="alert" :title="$t('dashboard.health.failed.title')">
      <template #description>
        <p>{{ $t('dashboard.health.failed.text') }}</p>
      </template>
      <template #actions>
        <UButton color="neutral" variant="outline" size="lg" class="min-h-11" @click="() => refresh()">
          {{ $t('dashboard.health.failed.retry') }}
        </UButton>
      </template>
    </UAlert>
  </UCard>
</template>
