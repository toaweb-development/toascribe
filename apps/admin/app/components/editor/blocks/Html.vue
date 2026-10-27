<script setup lang="ts">
import type { Block } from '@toascribe/blocks'
import { mayEditBlockType } from '@toascribe/blocks'

// Custom HTML (K-079, K-088): raw HTML, written and changed only by an account with unfiltered_html (the api refuses anything else).
// Everyone else sees the source, read-only, and can move or delete the block. The admin never draws it as markup: its scripts would
// get the page's nonce (packages/block-views, ViewContext.html).
const props = defineProps<{ block: Block; parentType: string | null; selected: boolean }>()
const editor = useBlockEditorContext()
const { t } = useI18n()

const mayEdit = computed(() => mayEditBlockType('core/html', editor.scope.value.capabilities))
const content = computed({
  get: () => (typeof props.block.attrs['content'] === 'string' ? props.block.attrs['content'] : ''),
  set: (value: string) => editor.setAttrs(props.block.id, { content: value }, `html:${props.block.id}`),
})
const root = useTemplateRef<HTMLElement>('root')
const handler = { focus: () => root.value?.querySelector<HTMLElement>('textarea, [tabindex="0"]')?.focus() }
onMounted(() => editor.registerFocus(props.block.id, handler))
onBeforeUnmount(() => editor.unregisterFocus(props.block.id, handler))
</script>

<template>
  <div ref="root" class="flex flex-col gap-1" @focusin="selected || editor.select({ blockId: block.id })">
    <EditorToolbar v-if="selected" :block="block" />
    <UTextarea
      v-if="mayEdit"
      v-model="content"
      autoresize
      :rows="3"
      spellcheck="false"
      :aria-label="t('blocks.html')"
      :placeholder="t('editor.html.placeholder')"
      class="w-full"
      :ui="{ base: 'font-mono text-sm' }"
      maxlength="100000"
    />
    <template v-else>
      <pre
        tabindex="0"
        :aria-label="t('blocks.html')"
        class="overflow-x-auto rounded-md border border-default bg-elevated p-2 font-mono text-sm whitespace-pre-wrap"
        >{{ content }}</pre>
      <p class="text-xs text-muted">{{ t('editor.html.readOnly') }}</p>
    </template>
  </div>
</template>
