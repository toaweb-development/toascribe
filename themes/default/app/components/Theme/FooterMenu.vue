<script setup lang="ts">
// The footer menu (the theme's `footer` location): one row of links, its levels flattened (a footer has no submenus to open).
import type { PublicMenuItem } from '@toascribe/shared'

const { t } = useI18n()
const items = useMenu('footer')
const flat = computed(() => {
  const all: PublicMenuItem[] = []
  const walk = (list: readonly PublicMenuItem[]) => {
    for (const item of list) {
      all.push(item)
      walk(item.children)
    }
  }
  walk(items.value)
  return all
})
</script>

<template>
  <nav v-if="flat.length > 0" class="theme-footer-nav" :aria-label="t('theme.menu.footer')">
    <ul>
      <li v-for="item in flat" :key="item.id" :class="item.cssClass">
        <a
          :href="item.url"
          :target="item.newTab ? '_blank' : undefined"
          :rel="item.newTab ? 'noopener noreferrer' : undefined"
          >{{ item.label }}</a
        >
      </li>
    </ul>
  </nav>
</template>
