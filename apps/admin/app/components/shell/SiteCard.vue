<script setup lang="ts">
// The site at the top of the side menu (M2.1, «Blekk»): its name, its address, and «Vis» to the site (outside the admin: a full page
// load, in the same tab).
const props = withDefaults(defineProps<{ collapsed?: boolean }>(), { collapsed: false })
const siteName = useSiteName()
const host = useRequestURL().host
</script>

<template>
  <div v-if="!props.collapsed" class="flex items-center gap-3 rounded-card border border-sidebar-line px-3 py-2.5">
    <span class="flex min-w-0 flex-1 flex-col">
      <span class="truncate font-medium text-sidebar-text">{{ siteName }}</span>
      <span class="truncate font-mono text-help text-sidebar-muted">{{ host }}</span>
    </span>
    <NuxtLink
      to="/"
      external
      class="inline-flex min-h-control items-center gap-1 rounded-menu px-2 text-help text-sidebar-muted hover:bg-sidebar-active hover:text-sidebar-text focus-visible:outline-sidebar-focus"
      :aria-label="$t('shell.site.visitLabel', { site: siteName })"
    >
      {{ $t('shell.site.visit') }}
      <UIcon name="i-lucide-arrow-up-right" class="size-3.5" aria-hidden="true" />
    </NuxtLink>
  </div>
</template>
