<script setup lang="ts">
// The sidebar's menu: what `GET /api/v1/admin/menu` gives, in the order it gives it (the api decides what this account may see; nothing
// is listed here). The current section and sub-item are marked. In the collapsed rail every item keeps its name and gets a tooltip,
// and a section with sub-items opens a popover (utils/admin-nav.ts).
const props = defineProps<{
  collapsed?: boolean
}>()

const { t, te } = useI18n()
const route = useRoute()
const adminApi = useAdminApi()

const { data, status, refresh } = await useAsyncData('admin:menu', () => adminApi.menu())

const label = (key: string) => menuLabel({ t, te }, key)
const entries = computed(() => data.value?.items ?? [])
const items = computed(() => toNavigationItems(entries.value, route.path, label, props.collapsed === true))
</script>

<template>
  <UNavigationMenu
    v-if="entries.length > 0"
    :aria-label="$t('shell.menu.label')"
    orientation="vertical"
    :items="items"
    :collapsed="collapsed"
    tooltip
    popover
  />
  <div v-else-if="status === 'pending'" role="status" class="flex flex-col gap-2">
    <span class="sr-only">{{ $t('shell.menu.loading') }}</span>
    <USkeleton v-for="n in 3" :key="n" role="presentation" aria-hidden="true" aria-label="" class="h-9 w-full" />
  </div>
  <UButton
    v-else-if="collapsed"
    icon="i-lucide-rotate-ccw"
    color="neutral"
    variant="outline"
    class="min-h-11 min-w-11 justify-center"
    :aria-label="$t('shell.menu.failed.retry')"
    @click="() => refresh()"
  />
  <UAlert v-else color="error" variant="subtle" role="alert" :title="$t('shell.menu.failed.title')">
    <template #description>
      <p>{{ $t('shell.menu.failed.text') }}</p>
    </template>
    <template #actions>
      <UButton color="neutral" variant="outline" size="lg" class="min-h-11" @click="() => refresh()">
        {{ $t('shell.menu.failed.retry') }}
      </UButton>
    </template>
  </UAlert>
</template>
