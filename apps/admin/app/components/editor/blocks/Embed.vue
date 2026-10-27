<script setup lang="ts">
import type { Block } from '@toascribe/blocks'
import { EMBED_PROVIDER_NAMES, EmbedProvider } from '@toascribe/shared'

// «Innbygging» (M1.6, K-225): the address of a video, a song or a post from a service toascribe knows, and a caption. «Bygg inn»
// asks the server what it shows (the service, the title); the editor shows that as a card, never the player (the admin loads
// nothing from another site). The save reads the address again on the server, whatever this block holds.
const props = defineProps<{ block: Block; parentType: string | null; selected: boolean }>()
const editor = useBlockEditorContext()
const { t } = useI18n()
const focusable = useFocusableBlock(() => props.block.id)
const appearanceApi = useAppearanceApi()
const uid = useId()

const attr = (key: string) => (typeof props.block.attrs[key] === 'string' ? (props.block.attrs[key] as string) : '')
const provider = computed(() => {
  const parsed = EmbedProvider.safeParse(attr('provider'))
  return parsed.success ? parsed.data : undefined
})
const draft = ref(attr('url'))
const status = ref<'idle' | 'reading' | 'found' | 'none'>(
  attr('url') !== '' && attr('frameSrc') !== '' ? 'found' : 'idle',
)

const placeholder = computed(() =>
  provider.value === undefined
    ? t('editor.embed.placeholder')
    : t('editor.embed.placeholderProvider', { service: EMBED_PROVIDER_NAMES[provider.value] }),
)

async function embed(): Promise<void> {
  const url = draft.value.trim()
  if (url === '') return
  status.value = 'reading'
  try {
    const answer = await appearanceApi.embedPreview(url)
    editor.setAttrs(props.block.id, {
      url,
      provider: answer.provider ?? '',
      title: answer.title,
      frameSrc: answer.frameSrc,
    })
    status.value = answer.provider === null ? 'none' : 'found'
  } catch {
    // What the server answered is cleared: the block is a link until the save reads the address again.
    editor.setAttrs(props.block.id, {
      url,
      ...Object.fromEntries(['provider', 'title', 'frameSrc'].map((key) => [key, ''])),
    })
    status.value = 'none'
  }
}

const caption = computed({
  get: () => attr('caption'),
  set: (value: string) => {
    editor.setAttrs(props.block.id, { caption: value })
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
      :aria-label="t('blocks.embed')"
      class="flex flex-col gap-3 rounded border border-dashed border-accented p-3 outline-none focus-visible:ring-2 focus-visible:ring-primary"
      @focus="focusable.onFocus"
    >
      <form class="flex flex-wrap items-end gap-2" @submit.prevent="embed">
        <UFormField :label="t('editor.embed.address')" :name="`${uid}-url`" class="min-w-0 flex-1">
          <UInput v-model="draft" type="url" inputmode="url" :placeholder="placeholder" class="w-full" />
        </UFormField>
        <UButton type="submit" class="min-h-11" :loading="status === 'reading'" :label="t('editor.embed.embed')" />
      </form>
      <p v-if="status === 'found' && provider" class="text-sm text-default" role="status">
        {{ t('editor.embed.found', { service: EMBED_PROVIDER_NAMES[provider], title: attr('title') || attr('url') }) }}
      </p>
      <p v-else-if="status === 'none'" class="text-sm text-warning" role="status">{{ t('editor.embed.notFound') }}</p>
      <p v-else-if="status === 'reading'" class="text-sm text-muted" role="status">{{ t('editor.embed.reading') }}</p>
      <p class="text-xs text-muted">{{ t('editor.embed.help') }}</p>
      <UFormField :label="t('editor.embed.caption')" :name="`${uid}-caption`">
        <UInput v-model="caption" maxlength="2000" class="w-full" />
      </UFormField>
    </div>
  </div>
</template>
