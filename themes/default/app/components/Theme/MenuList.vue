<script setup lang="ts">
// One level of a menu (and the levels below it): a link per item, and for an item with children a button that opens them, as the
// WAI disclosure pattern (aria-expanded, aria-controls). Works with the keyboard alone: Tab to a link or a button, Enter or Space to
// open, Escape to close the level and go back to its button.
import type { PublicMenuItem } from '@toascribe/shared'

const props = defineProps<{ items: readonly PublicMenuItem[]; level?: number }>()
const { t } = useI18n()
const route = useRoute()
const open = ref<string | null>(null)
const uid = useId()
const depth = computed(() => props.level ?? 0)

function toggle(id: string): void {
  open.value = open.value === id ? null : id
}
function close(id: string, event: KeyboardEvent): void {
  if (open.value !== id) return
  event.stopPropagation()
  open.value = null
  ;(document.getElementById(`${uid}-${id}-button`) as HTMLButtonElement | null)?.focus()
}
const current = (item: PublicMenuItem) => item.url === route.path
</script>

<template>
  <ul class="theme-menu-list" :data-level="depth">
    <li
      v-for="item in items"
      :key="item.id"
      class="theme-menu-item"
      :class="item.cssClass"
      @keydown.esc="close(item.id, $event)"
    >
      <span class="theme-menu-row">
        <a
          :href="item.url"
          :target="item.newTab ? '_blank' : undefined"
          :rel="item.newTab ? 'noopener noreferrer' : undefined"
          :aria-current="current(item) ? 'page' : undefined"
          >{{ item.label }}<span v-if="item.newTab" class="theme-sr-only"> {{ t('theme.menu.newTab') }}</span></a
        >
        <button
          v-if="item.children.length > 0"
          :id="`${uid}-${item.id}-button`"
          type="button"
          class="theme-menu-toggle"
          :aria-expanded="open === item.id ? 'true' : 'false'"
          :aria-controls="`${uid}-${item.id}`"
          @click="toggle(item.id)"
        >
          <span class="theme-sr-only">{{ t('theme.menu.submenu', { label: item.label }) }}</span>
          <span aria-hidden="true">▾</span>
        </button>
      </span>
      <div
        v-if="item.children.length > 0"
        :id="`${uid}-${item.id}`"
        class="theme-submenu"
        :data-open="open === item.id ? 'true' : 'false'"
      >
        <ThemeMenuList :items="item.children" :level="depth + 1" />
      </div>
    </li>
  </ul>
</template>
