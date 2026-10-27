<script setup lang="ts">
// The main menu (the theme's `primary` location): a row of links on a wide screen, behind a «Meny» button on a narrow one. The
// button is a disclosure (aria-expanded) and the menu a list of links: a navigation, not an ARIA menu.
const { t } = useI18n()
const items = useMenu('primary')
const open = ref(false)
const route = useRoute()
watch(
  () => route.fullPath,
  () => {
    open.value = false
  },
)
</script>

<template>
  <nav v-if="items.length > 0" class="theme-nav" :aria-label="t('theme.menu.primary')" @keydown.esc="open = false">
    <button
      type="button"
      class="theme-nav-toggle"
      aria-controls="theme-primary-menu"
      :aria-expanded="open ? 'true' : 'false'"
      @click="open = !open"
    >
      {{ t('theme.menu.open') }}
    </button>
    <div id="theme-primary-menu" class="theme-nav-menu" :data-open="open ? 'true' : 'false'">
      <ThemeMenuList :items="items" />
    </div>
  </nav>
</template>
