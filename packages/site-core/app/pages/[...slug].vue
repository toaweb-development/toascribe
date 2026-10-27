<script setup lang="ts">
// Every address of the site (M1.4): the middleware has asked the api what it is; this draws the first template of the answer's
// list that the theme has (WordPress' template hierarchy), and `index` when it has none of them. In maintenance mode (M1.7) the theme's
// `maintenance` template, or the core's page.
import { templates } from '#toascribe/theme'
import type { Component } from 'vue'

import { maintenanceView, pickTemplate } from '../lib/scribe'

const { templates: names } = useContent()
const maintenance = useMaintenance()
const coreMaintenance = resolveComponent('ScribeMaintenance') as Component
const view = computed(() =>
  maintenance.value ? maintenanceView(templates, coreMaintenance) : pickTemplate(names.value, templates),
)
// The maintenance page stands alone, without the theme's layout: no menus, sets or search come with it (nothing of the site's
// content), and nothing on it needs the api, which may be away during a restore.
// (A layout set for a route lasts for that route only: the next page has the theme's layout again.)
watchEffect(() => {
  if (maintenance.value) setPageLayout(false)
})
</script>

<template>
  <component :is="view" v-if="view" />
</template>
