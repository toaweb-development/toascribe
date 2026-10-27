<script setup lang="ts">
import { locate, validateDocument } from '@toascribe/blocks'
import type { GlobalSetDetail } from '@toascribe/shared'

// One global set in the block editor (K-106): its name and its blocks, saved together. The blocks are checked on the server as
// content's are (a custom HTML block needs unfiltered_html; «Les mer» and «Sideskift» belong to posts). Needs `edit_theme_options`.
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t } = useI18n()
const route = useRoute()
const auth = useAuth()
const appearanceApi = useAppearanceApi()
const id = computed(() => String(route.params['id'] ?? ''))

const capabilities = computed(
  () => new Set(auth.session.value.status === 'authenticated' ? auth.session.value.account.capabilities : []),
)
const mayEdit = computed(() => capabilities.value.has('edit_theme_options'))
if (import.meta.server && !mayEdit.value) {
  const event = useRequestEvent()
  if (event) setResponseStatus(event, 403)
}

const editor = useBlockEditor()
provideBlockEditor(editor)
watch(capabilities, (caps) => editor.setScope({ capabilities: caps, contentType: 'global_set' }), { immediate: true })
const mediaRefs = provideMediaRefs()

const { data, error } = await useAsyncData(
  `appearance:global-set:${id.value}`,
  () => appearanceApi.globalSet(id.value),
  {
    enabled: mayEdit,
  },
)
const name = ref('')
function take(loaded: GlobalSetDetail): void {
  name.value = loaded.name
  for (const entry of loaded.media) mediaRefs.value.set(entry.id, entry)
  const checked = validateDocument(loaded.blocks)
  editor.load(checked.ok ? checked.blocks : [])
}
watch(data, (loaded) => loaded && take(loaded), { immediate: true })
useSeoMeta({ title: () => t('appearance.sets.editTitle', { name: data.value?.name ?? '' }) })

const saving = ref(false)
const report = ref<string>()
const failure = ref<string>()
async function save(): Promise<void> {
  if (saving.value) return
  saving.value = true
  report.value = undefined
  failure.value = undefined
  const sent = editor.document.value
  try {
    const saved = await appearanceApi.saveGlobalSet(id.value, { name: name.value.trim(), blocks: sent })
    data.value = saved
    editor.markSaved(sent)
    report.value = t('appearance.sets.saved')
  } catch (caught) {
    failure.value = describeApiError(caught, t)
  } finally {
    saving.value = false
  }
}
const topPlace = computed(() => {
  const selected = editor.selectedId.value
  const located = selected === null ? undefined : locate(editor.document.value, selected)
  return located?.parentId === null
    ? { parentId: null, index: located.index + 1 }
    : { parentId: null, index: editor.document.value.length }
})
</script>

<template>
  <UDashboardPanel id="appearance-global-set">
    <template #header>
      <UDashboardNavbar :title="$t('appearance.sets.editTitle', { name: data?.name ?? '' })" />
    </template>
    <template #body>
      <section v-if="!mayEdit" aria-labelledby="set-denied" class="flex max-w-prose flex-col gap-3">
        <h2 id="set-denied" class="text-xl font-semibold text-highlighted">{{ $t('appearance.denied') }}</h2>
        <p class="text-base text-default">{{ $t('content.denied.text') }}</p>
      </section>
      <UAlert
        v-else-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :title="$t('appearance.sets.failed')"
      />
      <div v-else-if="data" class="flex flex-col gap-4">
        <div class="flex flex-wrap items-end gap-3">
          <UFormField :label="$t('appearance.sets.name')" name="set-name">
            <UInput v-model="name" maxlength="200" size="xl" class="w-full sm:w-80" />
          </UFormField>
          <p class="text-sm text-muted">
            {{ $t('appearance.sets.slugHelp') }} <code>{{ data.slug }}</code>
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2 border-b border-default py-2">
          <EditorInserter :place="topPlace" :parent-type="null" :label="$t('editor.addBlock')" />
          <UButton
            icon="i-lucide-undo-2"
            color="neutral"
            variant="ghost"
            :aria-label="$t('editorPrototype.undo')"
            :disabled="!editor.canUndo.value"
            @click="editor.undo()"
          />
          <UButton
            icon="i-lucide-redo-2"
            color="neutral"
            variant="ghost"
            :aria-label="$t('editorPrototype.redo')"
            :disabled="!editor.canRedo.value"
            @click="editor.redo()"
          />
          <UButton class="ms-auto min-h-11" size="lg" :loading="saving" @click="save">{{
            $t('appearance.sets.save')
          }}</UButton>
        </div>
        <div role="status">
          <UAlert v-if="report" color="success" variant="subtle" icon="i-lucide-circle-check" :title="report" />
        </div>
        <UAlert
          v-if="failure"
          color="error"
          variant="subtle"
          role="alert"
          icon="i-lucide-triangle-alert"
          :title="$t('appearance.sets.saveFailed')"
          :description="failure"
        />
        <div class="grid gap-6 lg:grid-cols-[1fr_18rem]">
          <EditorCanvas />
          <aside :aria-label="$t('editor.blockTab')">
            <EditorBlockSettings />
          </aside>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
