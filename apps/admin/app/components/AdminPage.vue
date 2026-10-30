<script setup lang="ts">
// Every screen of the admin inside the shell (M2.1, «Blekk»): the top bar with the breadcrumbs, «Hjelp» and «+ Ny», and below it the
// page on the app's background: its title (the page's one <h1>), its actions beside it (one filled main action at most), and the
// content at most 1180 px wide with 32 px around it.
const props = withDefaults(
  defineProps<{
    id: string
    /** The page's name, in the breadcrumbs and as its heading unless `heading` says otherwise. */
    title: string
    /** The heading when it is not the name (the dashboard's greeting). */
    heading?: string
    /** A line above the heading (the dashboard's date). */
    eyebrow?: string
    /** The page above this one in the breadcrumbs (a list above its item's editor). */
    parent?: { readonly label: string; readonly to: string }
    /** `wide` for screens that need the room (the customizer, the media library). */
    width?: 'content' | 'wide'
  }>(),
  { heading: undefined, eyebrow: undefined, parent: undefined, width: 'content' },
)
</script>

<template>
  <UDashboardPanel :id="props.id" :ui="{ body: 'bg-app p-0 sm:p-0' }">
    <template #header>
      <ShellTopbar :title="props.title" :parent="props.parent" />
    </template>

    <template #body>
      <div
        class="mx-auto flex w-full flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8"
        :class="props.width === 'wide' ? 'max-w-none' : 'max-w-content'"
      >
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div class="flex min-w-0 flex-col gap-1">
            <p v-if="props.eyebrow" class="text-help text-muted">{{ props.eyebrow }}</p>
            <h1 class="text-page-title font-semibold text-heading">{{ props.heading ?? props.title }}</h1>
          </div>
          <div v-if="$slots.actions" class="flex flex-wrap items-center gap-3">
            <slot name="actions" />
          </div>
        </div>
        <slot />
      </div>
    </template>
  </UDashboardPanel>
</template>
