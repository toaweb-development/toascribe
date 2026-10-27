<script setup lang="ts">
import type { Block } from '@toascribe/blocks'

// «Globalt sett» (K-106): which of the site's global sets is shown here. The set itself is edited in «Utseende → Globale sett»; the
// site draws its blocks where this block stands.
const props = defineProps<{ block: Block; parentType: string | null; selected: boolean }>()
const editor = useBlockEditorContext()
const { t } = useI18n()
const focusable = useFocusableBlock(() => props.block.id)
const appearanceApi = useAppearanceApi()
const uid = useId()

const sets = ref<{ label: string; value: string }[]>([])
onMounted(async () => {
  try {
    sets.value = (await appearanceApi.globalSets()).items.map((set) => ({ label: set.name, value: set.slug }))
  } catch {
    sets.value = []
  }
})
const slug = computed({
  get: () =>
    typeof props.block.attrs['slug'] === 'string' && props.block.attrs['slug'] !== ''
      ? props.block.attrs['slug']
      : undefined,
  set: (value: string | undefined) => {
    if (value !== undefined) editor.setAttrs(props.block.id, { slug: value })
  },
})
</script>

<template>
  <div class="flex flex-col gap-1">
    <EditorToolbar v-if="selected" :block="block" />
    <div
      :ref="focusable.ref"
      tabindex="0"
      role="group"
      :aria-label="t('blocks.globalSet')"
      class="flex flex-col gap-2 rounded border border-dashed border-accented p-3 outline-none focus-visible:ring-2 focus-visible:ring-primary"
      @focus="focusable.onFocus"
    >
      <UFormField :label="t('editor.globalSet.choose')" :name="`${uid}-set`">
        <USelect v-model="slug" :items="sets" :placeholder="t('editor.globalSet.placeholder')" class="w-full sm:w-72" />
      </UFormField>
      <p class="text-sm text-muted">{{ t('editor.globalSet.help') }}</p>
    </div>
  </div>
</template>
