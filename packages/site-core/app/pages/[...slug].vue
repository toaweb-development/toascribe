<script setup lang="ts">
// Every address of the site (M1.4): the middleware has asked the api what it is; this draws the first template of the answer's
// list that the theme has (WordPress' template hierarchy), and `index` when it has none of them.
import { templates } from '#toascribe/theme'

import { pickTemplate } from '../lib/scribe'

const { templates: names } = useContent()
const view = computed(() => pickTemplate(names.value, templates))
</script>

<template>
  <component :is="view" v-if="view" />
</template>
