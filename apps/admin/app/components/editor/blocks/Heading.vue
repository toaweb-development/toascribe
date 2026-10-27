<script setup lang="ts">
import type { Block } from '@toascribe/blocks'

// A heading (K-078): its level and its text. H2 to H6 are offered; H1 only where the theme allows it (it is the post's title), which the
// theme SDK says from M1.4, so a heading stored as H1 keeps it and the menu shows it then. Enter after a heading makes a paragraph.
const props = defineProps<{ block: Block; parentType: string | null; selected: boolean }>()
const editor = useBlockEditorContext()
const { t } = useI18n()

const level = computed(() => (typeof props.block.attrs['level'] === 'number' ? props.block.attrs['level'] : 2))
const LEVEL_CLASS: Readonly<Record<number, string>> = {
  1: 'text-3xl font-bold',
  2: 'text-2xl font-bold',
  3: 'text-xl font-bold',
  4: 'text-lg font-semibold',
  5: 'text-base font-semibold',
  6: 'text-sm font-semibold uppercase tracking-wide',
}
const levels = computed(() =>
  [...(level.value === 1 ? [1] : []), 2, 3, 4, 5, 6].map((n) => ({
    label: t('editor.heading.level', { n }),
    value: n,
  })),
)
</script>

<template>
  <EditorRichText
    :block="block"
    :label="t('editor.heading.label', { n: level })"
    :placeholder="t('editor.heading.placeholder')"
    :parent-type="parentType"
    :selected="selected"
    toolbar
    :text-class="LEVEL_CLASS[level] ?? ''"
  >
    <template #tools>
      <USelect
        :model-value="level"
        :items="levels"
        size="xs"
        :aria-label="t('editor.heading.levelLabel')"
        class="w-24"
        @update:model-value="(value: number) => editor.setAttrs(block.id, { level: value })"
      />
    </template>
  </EditorRichText>
</template>
