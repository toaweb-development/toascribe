<script setup lang="ts">
// The box a list's table sits in (M2.1, «Blekk»), and how a list looks on a narrow screen. From `md` it is a table with its columns.
// Below `md` the rows stack, as WordPress' list tables do (workflows §29: no table that scrolls sideways): only the checkbox cell and
// the row's main cell stay, and the main cell holds the title, a BlekkRowMeta line (status and date, or what the hidden columns say)
// and the BlekkRowActions, always shown. A table hides its other cells there with `max-md:hidden` and gives itself a width only
// `md:` up. It stays a table, so a screen reader and the bulk checkboxes work the same at every width. The box takes focus so the
// keyboard can scroll a wide table from `md` (axe's scrollable-region-focusable), and its name is the table's.
const props = defineProps<{ label: string }>()
</script>

<template>
  <div
    role="region"
    :aria-label="props.label"
    tabindex="0"
    class="overflow-x-auto rounded-card border border-line bg-surface"
  >
    <slot />
  </div>
</template>
