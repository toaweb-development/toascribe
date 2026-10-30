<script setup lang="ts">
// The bar across the top of a page (M2.1, «Blekk»): the menu button on a narrow screen, the breadcrumbs (the site, the page above, the
// page), and «Hjelp», «+ Ny» and, on a narrow screen where the side menu is hidden, the account's menu. The search field with Ctrl K
// comes with the command palette (K-041), later in phase 2.
const props = defineProps<{ title: string; parent?: { readonly label: string; readonly to: string } | undefined }>()

const { t } = useI18n()
const siteName = useSiteName()
const auth = useAuth()
const route = useRoute()
const config = useRuntimeConfig()
const help = computed(() => helpUrl(route.path, config.public.version))

const can = (capability: string) =>
  auth.session.value.status === 'authenticated' && auth.session.value.account.capabilities.includes(capability)
const newItems = computed(() =>
  [
    can('edit_posts') && { label: t('shell.new.post'), icon: 'i-lucide-pen-line', to: '/posts/new' },
    can('edit_pages') && { label: t('shell.new.page'), icon: 'i-lucide-file', to: '/pages/new' },
    can('upload_files') && { label: t('shell.new.media'), icon: 'i-lucide-image', to: '/media/new' },
    can('create_users') && { label: t('shell.new.user'), icon: 'i-lucide-user-plus', to: '/users/new' },
  ].filter((item) => item !== false),
)
</script>

<template>
  <UDashboardNavbar :ui="{ root: 'bg-topbar border-line min-h-16 px-4 sm:px-8', title: 'min-w-0' }">
    <template #leading>
      <UDashboardSidebarCollapse class="hidden lg:inline-flex" />
    </template>
    <template #title>
      <nav :aria-label="$t('shell.breadcrumbs')" class="min-w-0">
        <ol class="flex min-w-0 items-center gap-1.5 text-help">
          <li class="hidden truncate text-muted sm:block">
            <ULink to="/" class="text-muted hover:text-highlighted hover:underline">{{ siteName }}</ULink>
          </li>
          <li v-if="props.parent" class="hidden items-center gap-1.5 text-muted sm:flex">
            <span aria-hidden="true">/</span>
            <ULink :to="props.parent.to" class="text-muted hover:text-highlighted hover:underline">{{
              props.parent.label
            }}</ULink>
          </li>
          <li class="flex min-w-0 items-center gap-1.5">
            <span class="hidden text-muted sm:inline" aria-hidden="true">/</span>
            <span class="truncate font-medium text-highlighted" aria-current="page">{{ props.title }}</span>
          </li>
        </ol>
      </nav>
    </template>
    <template #right>
      <UButton
        :to="help"
        target="_blank"
        rel="noopener noreferrer"
        color="neutral"
        variant="outline"
        icon="i-lucide-circle-help"
        :aria-label="$t('shell.bar.helpLabel')"
      >
        <span class="hidden sm:inline">{{ $t('shell.bar.help') }}</span>
      </UButton>
      <UDropdownMenu v-if="newItems.length > 0" :items="newItems" :content="{ align: 'end' }">
        <UButton color="neutral" variant="outline" icon="i-lucide-plus" :aria-label="$t('shell.new.label')">
          <span class="hidden sm:inline">{{ $t('shell.new.button') }}</span>
        </UButton>
      </UDropdownMenu>
      <ShellUserMenu class="lg:hidden" compact />
    </template>
  </UDashboardNavbar>
</template>
