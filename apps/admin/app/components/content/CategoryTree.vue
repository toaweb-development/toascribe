<script setup lang="ts">
import type { TermItem } from '@toascribe/shared'

// The categories as a tree of checkboxes, as in WordPress' quick edit and category box: each child indented under its parent. The
// terms come in tree order with their depth (GET /taxonomies/category/terms). A long list scrolls inside its frame.
const props = defineProps<{ terms: readonly TermItem[]; legend: string }>()
const selected = defineModel<string[]>({ required: true })

function toggle(id: string, on: boolean | 'indeterminate') {
  selected.value = on === true ? [...new Set([...selected.value, id])] : selected.value.filter((entry) => entry !== id)
}

const indent = (depth: number) => ['', 'ps-6', 'ps-12', 'ps-18', 'ps-24'][Math.min(depth, 4)] ?? 'ps-24'
const empty = computed(() => props.terms.length === 0)
</script>

<template>
  <fieldset class="flex flex-col gap-1">
    <legend class="mb-1 font-medium text-default">{{ legend }}</legend>
    <p v-if="empty" class="text-sm text-toned">{{ $t('terms.categories.empty') }}</p>
    <ul v-else class="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border border-default p-2">
      <li v-for="term in terms" :key="term.id" :class="indent(term.depth)">
        <UCheckbox
          size="lg"
          :model-value="selected.includes(term.id)"
          :label="term.name"
          @update:model-value="toggle(term.id, $event)"
        />
      </li>
    </ul>
  </fieldset>
</template>
