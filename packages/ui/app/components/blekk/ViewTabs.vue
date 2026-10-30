<script setup lang="ts">
// The views above a list (M2.1, «Blekk», docs/design/blekk/Posts.dc.html; WordPress' subsubsub): «Alle 2», «Publisert 2», … as links
// under a line, the current one marked with the accent's line and `aria-current="page"`. They are links, not ARIA tabs: each view is
// an address of its own, so the keyboard moves through them with Tab and the browser's back button works.
import type { RouteLocationRaw } from 'vue-router'

export interface ViewTab {
  readonly key: string
  readonly label: string
  readonly count?: number
  readonly to: RouteLocationRaw
  readonly current: boolean
}

const props = defineProps<{ items: readonly ViewTab[]; label: string }>()
</script>

<template>
  <nav :aria-label="props.label" class="-mx-1 overflow-x-auto border-b border-line px-1">
    <ul class="flex min-w-max gap-1">
      <li v-for="item in props.items" :key="item.key">
        <NuxtLink
          :to="item.to"
          :aria-current="item.current ? 'page' : undefined"
          class="-mb-px inline-flex min-h-control-main items-center gap-1.5 border-b-2 px-3 text-body hover:text-heading"
          :class="item.current ? 'border-accent font-semibold text-heading' : 'border-transparent text-secondary'"
        >
          {{ item.label }}
          <!-- Read as «Alle (12)»: the brackets are for the ear only. -->
          <span
            v-if="item.count !== undefined"
            class="font-mono text-help"
            :class="item.current ? 'text-secondary' : ''"
          >
            <span class="sr-only">(</span>{{ item.count }}<span class="sr-only">)</span>
          </span>
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>
