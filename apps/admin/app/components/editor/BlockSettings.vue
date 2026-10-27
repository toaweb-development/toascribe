<script setup lang="ts">
import type { Block } from '@toascribe/blocks'
import { findBlock, HEADING, PARAGRAPH, QUERY } from '@toascribe/blocks'

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

const activeTheme = useActiveTheme()
const headingLevels = computed(() =>
  headingLevelsFor(activeTheme.value, attr<number>('level', 2)).map((n) => ({
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
// The Query Loop (K-085): its choices, and the categories to choose from (read when such a block is selected).
const termsApi = useTermsApi()
const categories = ref<{ label: string; value: string }[]>([])
watch(
  () => block.value?.type === QUERY,
  async (isQuery) => {
    if (!isQuery || categories.value.length > 0) return
    try {
      categories.value = (await termsApi.all('category')).map((term) => ({ label: term.name, value: term.slug }))
    } catch {
      categories.value = []
    }
  },
  { immediate: true },
)
const ALL = '__all__'
const categoryItems = computed(() => [{ label: t('editor.query.allCategories'), value: ALL }, ...categories.value])
const typeItems = computed(() => [
  { label: t('content.posts.singular'), value: 'post' },
  { label: t('content.pages.singular'), value: 'page' },
])
const orderItems = computed(() => [
  { label: t('editor.query.orderNewest'), value: 'date:desc' },
  { label: t('editor.query.orderOldest'), value: 'date:asc' },
  { label: t('editor.query.orderTitle'), value: 'title:asc' },
])
const stickyItems = computed(() => [
  { label: t('editor.query.stickyInclude'), value: 'include' },
  { label: t('editor.query.stickyExclude'), value: 'exclude' },
  { label: t('editor.query.stickyFirst'), value: 'first' },
])
function setOrder(value: string): void {
  const [orderBy = 'date', order = 'desc'] = value.split(':')
  set({ orderBy, order })
}

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

      <template v-else-if="block.type === QUERY">
        <UFormField :label="t('editor.query.type')" :name="`${uid}-query-type`">
          <USelect
            :model-value="attr('postType', 'post')"
            :items="typeItems"
            class="w-full"
            @update:model-value="(value: string) => set({ postType: value })"
          />
        </UFormField>
        <UFormField :label="t('editor.query.perPage')" :name="`${uid}-query-count`">
          <UInputNumber
            :model-value="attr('perPage', 5)"
            :min="1"
            :max="50"
            class="w-full"
            @update:model-value="
              (value: number | null) => set({ perPage: value ?? 5 }, `query-count:${block?.id ?? ''}`)
            "
          />
        </UFormField>
        <template v-if="attr('postType', 'post') === 'post'">
          <UFormField :label="t('editor.query.category')" :name="`${uid}-query-category`">
            <USelect
              :model-value="attr('category', '') || ALL"
              :items="categoryItems"
              class="w-full"
              @update:model-value="(value: string) => set({ category: value === ALL ? '' : value })"
            />
          </UFormField>
          <UFormField :label="t('editor.query.tag')" :name="`${uid}-query-tag`">
            <UInput
              :model-value="attr('tag', '')"
              maxlength="200"
              class="w-full"
              @update:model-value="
                (value: string | number) => set({ tag: String(value).trim() }, `query-tag:${block?.id ?? ''}`)
              "
            />
          </UFormField>
          <UFormField :label="t('editor.query.sticky')" :name="`${uid}-query-sticky`">
            <USelect
              :model-value="attr('sticky', 'include')"
              :items="stickyItems"
              class="w-full"
              @update:model-value="(value: string) => set({ sticky: value })"
            />
          </UFormField>
        </template>
        <UFormField :label="t('editor.query.order')" :name="`${uid}-query-order`">
          <USelect
            :model-value="`${attr('orderBy', 'date')}:${attr('order', 'desc')}`"
            :items="orderItems"
            class="w-full"
            @update:model-value="setOrder"
          />
        </UFormField>
        <USwitch
          :model-value="attr('showDate', true)"
          :label="t('editor.query.showDate')"
          @update:model-value="(value: boolean) => set({ showDate: value })"
        />
        <USwitch
          :model-value="attr('showExcerpt', true)"
          :label="t('editor.query.showExcerpt')"
          @update:model-value="(value: boolean) => set({ showExcerpt: value })"
        />
      </template>

      <p v-else class="text-sm text-muted">{{ t('editor.settings.nothing') }}</p>
    </template>
  </div>
</template>
