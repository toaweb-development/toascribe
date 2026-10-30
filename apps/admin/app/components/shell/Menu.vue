<script setup lang="ts">
// The side menu (M2.1, «Blekk»; WordPress' admin menu): what `GET /api/v1/admin/menu` gives, in its order (the api decides what this
// account may see). The section the page is in shows its sub-items under it; another section's sub-items float beside it, on hover
// or with its button from the keyboard (a section link is a link, so it cannot also open a menu). Collapsed to icons, every section
// is a button that opens the same floating menu, with the section itself first.
import type { AdminMenuEntry } from '@toascribe/shared'

const props = withDefaults(defineProps<{ collapsed?: boolean }>(), { collapsed: false })

const { t, te } = useI18n()
const route = useRoute()
const adminApi = useAdminApi()

const { data, status, refresh } = await useAsyncData('admin:menu', () => adminApi.menu())

const label = (key: string) => menuLabel({ t, te }, key)
const entries = computed(() => data.value?.items ?? [])
const section = computed(() => sectionOf(entries.value, route.path))
const childId = (entry: AdminMenuEntry) => activeChildId(entry, route.path)

// One floating menu at a time; the pointer opens it after a moment and closes it after leaving both the row and the menu.
const open = ref<string>()
let timer: ReturnType<typeof setTimeout> | undefined
// A menu the pointer opened leaves the keyboard's focus where it was (someone typing in a field who moves the mouse over the menu
// keeps typing there); one opened by a click or the keyboard takes the focus to its first link and gives it back on Escape.
const byPointer = ref(false)
function hover(id: string | undefined, delay: number): void {
  clearTimeout(timer)
  timer = setTimeout(() => {
    if (id !== undefined && open.value !== id) byPointer.value = true
    open.value = id
  }, delay)
}
function setOpen(id: string, value: boolean): void {
  clearTimeout(timer)
  if (value) byPointer.value = false
  open.value = value ? id : open.value === id ? undefined : open.value
}
function keepFocus(event: Event): void {
  if (byPointer.value) event.preventDefault()
}
watch(
  () => route.fullPath,
  () => {
    open.value = undefined
  },
)
onBeforeUnmount(() => clearTimeout(timer))

const linkClass =
  'flex min-h-control items-center gap-3 rounded-menu px-3 text-sidebar-text hover:bg-sidebar-active focus-visible:outline-sidebar-focus'
const flyoutLinkClass =
  'flex min-h-control items-center rounded-menu px-3 text-default hover:bg-elevated aria-[current=page]:font-medium aria-[current=page]:text-accent-text'
</script>

<template>
  <nav v-if="entries.length > 0" :aria-label="$t('shell.menu.label')">
    <ul class="flex flex-col gap-0.5">
      <li
        v-for="entry in entries"
        :key="entry.id"
        @mouseenter="entry.children.length > 0 && (props.collapsed || entry.id !== section) && hover(entry.id, 120)"
        @mouseleave="hover(undefined, 200)"
      >
        <!-- Collapsed: the icon opens the section's menu. -->
        <UPopover
          v-if="props.collapsed"
          :open="open === entry.id"
          :content="{
            side: 'right',
            align: 'start',
            sideOffset: 8,
            onOpenAutoFocus: keepFocus,
            onCloseAutoFocus: keepFocus,
          }"
          @update:open="(value: boolean) => setOpen(entry.id, value)"
        >
          <button
            type="button"
            :class="[linkClass, 'w-full justify-center px-0', { 'bg-sidebar-active': entry.id === section }]"
            :aria-label="label(entry.labelKey)"
          >
            <UIcon :name="entry.icon" class="size-5 shrink-0 text-sidebar-muted" aria-hidden="true" />
          </button>
          <template #content>
            <ul
              class="flex min-w-48 flex-col gap-0.5 p-1.5"
              :aria-label="label(entry.labelKey)"
              @mouseenter="hover(entry.id, 0)"
              @mouseleave="hover(undefined, 200)"
            >
              <li>
                <NuxtLink
                  :to="entry.to"
                  :class="[flyoutLinkClass, 'font-semibold text-heading']"
                  :aria-current="route.path === entry.to ? 'page' : undefined"
                >
                  {{ label(entry.labelKey) }}
                </NuxtLink>
              </li>
              <li v-for="child in entry.children" :key="child.id">
                <NuxtLink
                  :to="child.to"
                  :class="flyoutLinkClass"
                  :aria-current="childId(entry) === child.id ? 'page' : undefined"
                >
                  {{ label(child.labelKey) }}
                </NuxtLink>
              </li>
            </ul>
          </template>
        </UPopover>

        <template v-else>
          <div class="flex items-center gap-1">
            <NuxtLink
              :to="entry.to"
              :class="[linkClass, 'flex-1', { 'bg-sidebar-active font-medium': entry.id === section }]"
              :aria-current="entry.id === section && childId(entry) === undefined ? 'page' : undefined"
            >
              <UIcon :name="entry.icon" class="size-5 shrink-0 text-sidebar-muted" aria-hidden="true" />
              <span class="truncate">{{ label(entry.labelKey) }}</span>
            </NuxtLink>
            <UPopover
              v-if="entry.children.length > 0 && entry.id !== section"
              :open="open === entry.id"
              :content="{
                side: 'right',
                align: 'start',
                sideOffset: 12,
                onOpenAutoFocus: keepFocus,
                onCloseAutoFocus: keepFocus,
              }"
              @update:open="(value: boolean) => setOpen(entry.id, value)"
            >
              <button
                type="button"
                class="inline-flex size-control shrink-0 items-center justify-center rounded-menu text-sidebar-muted hover:bg-sidebar-active hover:text-sidebar-text focus-visible:outline-sidebar-focus"
                :aria-label="$t('shell.menu.open', { name: label(entry.labelKey) })"
              >
                <UIcon name="i-lucide-chevron-right" class="size-4" aria-hidden="true" />
              </button>
              <template #content>
                <ul
                  class="flex min-w-48 flex-col gap-0.5 p-1.5"
                  :aria-label="label(entry.labelKey)"
                  @mouseenter="hover(entry.id, 0)"
                  @mouseleave="hover(undefined, 200)"
                >
                  <li v-for="child in entry.children" :key="child.id">
                    <NuxtLink :to="child.to" :class="flyoutLinkClass">{{ label(child.labelKey) }}</NuxtLink>
                  </li>
                </ul>
              </template>
            </UPopover>
          </div>
          <ul v-if="entry.id === section && entry.children.length > 0" class="mt-0.5 mb-1 flex flex-col gap-0.5 ps-8">
            <li v-for="child in entry.children" :key="child.id">
              <NuxtLink
                :to="child.to"
                :class="[
                  linkClass,
                  'text-sidebar-muted hover:text-sidebar-text',
                  { 'font-medium text-sidebar-text': childId(entry) === child.id },
                ]"
                :aria-current="childId(entry) === child.id ? 'page' : undefined"
              >
                {{ label(child.labelKey) }}
              </NuxtLink>
            </li>
          </ul>
        </template>
      </li>
    </ul>
  </nav>
  <div v-else-if="status === 'pending'" role="status" class="flex flex-col gap-2">
    <span class="sr-only">{{ $t('shell.menu.loading') }}</span>
    <USkeleton
      v-for="n in 3"
      :key="n"
      role="presentation"
      aria-hidden="true"
      aria-label=""
      class="h-9 w-full bg-sidebar-active"
    />
  </div>
  <div v-else role="alert" class="flex flex-col gap-2 text-sidebar-text">
    <p class="font-medium">{{ $t('shell.menu.failed.title') }}</p>
    <p class="text-help text-sidebar-muted">{{ $t('shell.menu.failed.text') }}</p>
    <button
      type="button"
      class="inline-flex min-h-control items-center gap-2 rounded-menu px-3 text-sidebar-text ring ring-sidebar-line hover:bg-sidebar-active focus-visible:outline-sidebar-focus"
      @click="() => refresh()"
    >
      <UIcon name="i-lucide-rotate-ccw" class="size-4" aria-hidden="true" />
      {{ $t('shell.menu.failed.retry') }}
    </button>
  </div>
</template>
