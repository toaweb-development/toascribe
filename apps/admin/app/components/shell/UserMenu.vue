<script setup lang="ts">
// The account at the foot of the side menu (M2.1, «Blekk»): its picture or initials, its name and its role, and a menu with the profile
// and «Logg ut». `compact` is the same menu as a round button for the top bar of a narrow screen. Its name says «Hei, …», as the
// admin bar's did (WordPress' «Howdy»).
const props = withDefaults(defineProps<{ compact?: boolean; collapsed?: boolean }>(), {
  compact: false,
  collapsed: false,
})

const { t } = useI18n()
const auth = useAuth()

const account = computed(() => (auth.session.value.status === 'authenticated' ? auth.session.value.account : undefined))
const name = computed(() => account.value?.displayName ?? '')
const role = computed(() => {
  const first = account.value?.roles[0]
  return first === undefined ? '' : roleLabel(t, first, undefined)
})
const items = computed(() => [
  [
    { label: t('shell.bar.profile'), icon: 'i-lucide-user', to: '/profile' },
    { label: t('auth.logout.link'), icon: 'i-lucide-log-out', to: '/logout' },
  ],
])
const label = computed(() => `${t('shell.bar.howdy', { name: name.value })}. ${t('shell.bar.userMenu')}`)
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: props.compact ? 'end' : 'start', side: props.compact ? 'bottom' : 'top' }"
  >
    <UButton v-if="props.compact" color="neutral" variant="ghost" class="rounded-full p-0" :aria-label="label">
      <UAvatar :alt="name" size="md" :ui="{ fallback: 'text-default' }" />
    </UButton>
    <button
      v-else
      type="button"
      class="flex min-h-control w-full items-center gap-3 rounded-menu px-2 py-2 text-start text-sidebar-text hover:bg-sidebar-active focus-visible:outline-sidebar-focus"
      :aria-label="label"
    >
      <UAvatar :alt="name" size="md" class="shrink-0" :ui="{ root: 'bg-accent-weak', fallback: 'text-accent-text' }" />
      <span v-if="!props.collapsed" class="flex min-w-0 flex-col">
        <span class="truncate font-medium">{{ name }}</span>
        <span class="truncate text-help text-sidebar-muted">{{ role }}</span>
      </span>
    </button>
  </UDropdownMenu>
</template>
