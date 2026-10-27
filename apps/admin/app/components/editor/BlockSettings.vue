<script setup lang="ts">
import type { Block } from '@toascribe/blocks'
import { findBlock, HEADING, PARAGRAPH } from '@toascribe/blocks'

// The «Blokk» tab of the sidebar: the settings of the selected block that are not in its toolbar or its own fields. A paragraph can
// become a heading and back; the rest are the block's attributes (heading level, list kind, table header and caption, gallery columns,
// cropping and link, button style, spacer size, «Les mer» text). Each change is a step of the editor's one history.
const editor = useBlockEditorContext()
const { title } = useBlockText()
const { t } = useI18n()
const uid = useId()

const block = computed<Block | undefined>(() => {
  const id = editor.selectedId.value
  return id === null || editor.multi.value.length > 0 ? undefined : findBlock(editor.document.value, id)
})
const attr = <T,>(key: string, fallback: T): T => {
  const value = block.value?.attrs[key]
  return (value === undefined ? fallback : value) as T
}
function set(attrs: Record<string, unknown>, group?: string): void {
  if (block.value !== undefined) editor.setAttrs(block.value.id, attrs, group)
}

const headingLevels = computed(() =>
  [...(attr<number>('level', 2) === 1 ? [1] : []), 2, 3, 4, 5, 6].map((n) => ({
    label: t('editor.heading.level', { n }),
    value: n,
  })),
)
const galleryColumns = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ label: String(n), value: n }))
const linkOptions = computed(() => [
  { label: t('editor.gallery.linkNone'), value: 'none' },
  { label: t('editor.gallery.linkFile'), value: 'file' },
])
const variants = computed(() => [
  { label: t('editor.button.fill'), value: 'fill' },
  { label: t('editor.button.outline'), value: 'outline' },
])
const sizes = computed(() =>
  ['small', 'medium', 'large', 'x-large'].map((size) => ({ label: spacerSizeLabel(t, size), value: size })),
)
</script>

<template>
  <div class="flex flex-col gap-4">
    <p v-if="editor.multi.value.length > 0" class="text-sm text-toned">
      {{ t('editor.selection.count', { n: editor.multi.value.length }, editor.multi.value.length) }}
    </p>
    <p v-else-if="!block" class="text-sm text-muted">{{ t('editor.settings.none') }}</p>
    <template v-else>
      <h3 class="font-semibold text-highlighted">{{ title(block.type) }}</h3>

      <template v-if="block.type === PARAGRAPH">
        <UButton
          icon="i-lucide-heading"
          color="neutral"
          variant="outline"
          class="min-h-11 self-start"
          :label="t('editor.settings.toHeading')"
          @click="editor.transform(block.id, HEADING, { level: 2 })"
        />
      </template>

      <template v-else-if="block.type === HEADING">
        <UFormField :label="t('editor.heading.levelLabel')" :name="`${uid}-level`">
          <USelect
            :model-value="attr('level', 2)"
            :items="headingLevels"
            class="w-full"
            @update:model-value="(value: number) => set({ level: value })"
          />
        </UFormField>
        <UButton
          icon="i-lucide-pilcrow"
          color="neutral"
          variant="outline"
          class="min-h-11 self-start"
          :label="t('editor.settings.toParagraph')"
          @click="editor.transform(block.id, PARAGRAPH)"
        />
      </template>

      <USwitch
        v-else-if="block.type === 'core/list'"
        :model-value="attr('ordered', false)"
        :label="t('editor.list.numbered')"
        @update:model-value="(value: boolean) => set({ ordered: value })"
      />

      <template v-else-if="block.type === 'core/table'">
        <USwitch
          :model-value="attr('hasHeader', true)"
          :label="t('editor.table.header')"
          @update:model-value="(value: boolean) => set({ hasHeader: value })"
        />
        <UFormField :label="t('editor.table.caption')" :name="`${uid}-caption`">
          <UInput
            :model-value="attr('caption', '')"
            class="w-full"
            maxlength="1000"
            @update:model-value="(value: string) => set({ caption: value }, `caption:${block?.id}`)"
          />
        </UFormField>
      </template>

      <template v-else-if="block.type === 'core/gallery'">
        <UFormField :label="t('editor.gallery.columns')" :name="`${uid}-columns`">
          <USelect
            :model-value="attr('columns', 3)"
            :items="galleryColumns"
            class="w-full"
            @update:model-value="(value: number) => set({ columns: value })"
          />
        </UFormField>
        <USwitch
          :model-value="attr('crop', true)"
          :label="t('editor.gallery.crop')"
          @update:model-value="(value: boolean) => set({ crop: value })"
        />
        <UFormField :label="t('editor.gallery.link')" :name="`${uid}-link`">
          <USelect
            :model-value="attr('linkTo', 'none')"
            :items="linkOptions"
            class="w-full"
            @update:model-value="(value: string) => set({ linkTo: value })"
          />
        </UFormField>
      </template>

      <UFormField v-else-if="block.type === 'core/button'" :label="t('editor.button.style')" :name="`${uid}-variant`">
        <USelect
          :model-value="attr('variant', 'fill')"
          :items="variants"
          class="w-full"
          @update:model-value="(value: string) => set({ variant: value })"
        />
      </UFormField>

      <UFormField v-else-if="block.type === 'core/spacer'" :label="t('editor.spacer.size')" :name="`${uid}-size`">
        <USelect
          :model-value="attr('size', 'medium')"
          :items="sizes"
          class="w-full"
          @update:model-value="(value: string) => set({ size: value })"
        />
      </UFormField>

      <USwitch
        v-else-if="block.type === 'core/more'"
        :model-value="attr('noTeaser', false)"
        :label="t('editor.more.noTeaser')"
        @update:model-value="(value: boolean) => set({ noTeaser: value })"
      />

      <p v-else class="text-sm text-muted">{{ t('editor.settings.nothing') }}</p>
    </template>
  </div>
</template>
