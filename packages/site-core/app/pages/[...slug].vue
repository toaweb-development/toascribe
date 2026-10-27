<script setup lang="ts">
// Every address of the site (M1.4): the middleware has asked the api what it is; this draws the first template of the answer's
// list that the theme has (WordPress' template hierarchy), and `index` when it has none of them. In maintenance mode (M1.7) the theme's
// `maintenance` template, or the core's page.
import { templates } from '#toascribe/theme'

import { pickTemplate } from '../lib/scribe'

const { templates: names } = useContent()
const maintenance = useMaintenance()
const coreMaintenance = resolveComponent('ScribeMaintenance')
const view = computed(() =>
  maintenance.value
    ? Object.hasOwn(templates, 'maintenance')
      ? templates['maintenance']
      : coreMaintenance
    : pickTemplate(names.value, templates),
)
</script>

<template>
  <component :is="view" v-if="view" />
</template>
