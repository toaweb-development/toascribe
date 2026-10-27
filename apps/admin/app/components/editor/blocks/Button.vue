<script setup lang="ts">
import type { Block } from '@toascribe/blocks'
import { isSafeHref } from '@toascribe/blocks'

// A button: its text (rich text, one line) and its address, which must be one a link may have (https:, http:, mailto:, a path on the
// site or #…). Without an address it is drawn as text in a button's shape, not as a link.
const props = defineProps<{ block: Block; parentType: string | null; selected: boolean }>()
const editor = useBlockEditorContext()
const { t } = useI18n()
const uid = useId()

const url = computed({
  get: () => (typeof props.block.attrs['url'] === 'string' ? props.block.attrs['url'] : ''),
  set: (value: string) => editor.setAttrs(props.block.id, { url: value.trim() }, `url:${props.block.id}`),
})
const invalid = computed(() => url.value !== '' && !isSafeHref(url.value))
const outline = computed(() => props.block.attrs['variant'] === 'outline')
</script>

<template>
  <div class="flex flex-col gap-1">
    <EditorRichText
      :block="block"
      attr="text"
      enter="none"
      :label="t('editor.button.text')"
      :placeholder="t('editor.button.placeholder')"
      :selected="selected"
      toolbar
      :text-class="
        outline
          ? 'rounded-md border-2 border-primary px-4 font-semibold text-primary'
          : 'rounded-md bg-primary px-4 font-semibold text-inverted'
      "
    />
    <UFormField
      v-if="selected"
      :label="t('editor.button.url')"
      :name="`${uid}-url`"
      :error="invalid ? t('editorPrototype.paragraph.linkInvalid') : undefined"
    >
      <UInput v-model="url" type="url" inputmode="url" autocomplete="off" size="sm" class="w-64" maxlength="2048" />
    </UFormField>
  </div>
</template>
