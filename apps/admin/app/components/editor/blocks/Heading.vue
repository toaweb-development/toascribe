<script setup lang="ts">
import type { Block } from '@toascribe/blocks'

// A heading (K-078): its level and its text. The levels are the active theme's (`supports.headingLevels`, M1.4; H2 to H6 without an
// answer), and a heading keeps the level it has. Enter after a heading makes a paragraph.
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
const activeTheme = useActiveTheme()
const levels = computed(() =>
  headingLevelsFor(activeTheme.value, level.value).map((n) => ({
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
