<script setup lang="ts">
import type { BlockDocument } from '@toascribe/blocks'
import { flatten, validateDocument } from '@toascribe/blocks'
import { InvalidBlocksResponse } from '@toascribe/shared'

// PROTOTYPE (M0.6): the block editor prototype. Loads the signed-in account's own prototype draft, lets it be edited with columns,
// images and paragraphs, and saves it back. The blocks are checked against their block.json here before saving, and the api checks
// them again. Not in the menu: it is reached by its address, and goes away when the real editor comes (M1.3).
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t } = useI18n()
useSeoMeta({ title: () => t('editorPrototype.title') })

const auth = useAuth()
const prototypeApi = useEditorPrototypeApi()
const toast = useToast()
const { title, issue } = useBlockText()

const mayEdit = computed(
  () => auth.session.value.status === 'authenticated' && auth.session.value.account.capabilities.includes('edit_posts'),
)
if (import.meta.server && !mayEdit.value) {
  const event = useRequestEvent()
  if (event) {
    setResponseStatus(event, 403)
  }
}

const editor = useBlockEditor()
provideBlockEditor(editor)

const { data, status, refresh } = await useAsyncData('editor-prototype:document', async () =>
  mayEdit.value ? await prototypeApi.get() : null,
)

// A stored draft that does not pass the check (changed behind the api's back) is not loaded and cannot be overwritten from here:
// the page says so instead of starting from an empty document that the next save would store over it.
const storedInvalid = ref(false)
watch(
  data,
  (loaded) => {
    if (loaded != null) {
      const checked = validateDocument(loaded.blocks)
      storedInvalid.value = !checked.ok
      editor.load(checked.ok ? checked.blocks : [])
    }
  },
  { immediate: true },
)

useUnsavedGuard(() => editor.dirty.value)

const saving = ref(false)
const issues = ref<{ key: string; text: string }[]>([])

/** An issue as the person reads it: which block (by its name and place) and what is wrong. */
function describe(
  found: { readonly path: readonly (string | number)[]; readonly code: string },
  document: BlockDocument,
): { key: string; text: string } {
  let blocks: readonly { type: string; children: readonly unknown[] }[] = document
  let type = ''
  for (const part of found.path) {
    if (typeof part === 'number') {
      const block = blocks[part]
      if (block === undefined) break
      type = block.type
      blocks = block.children as typeof blocks
    } else if (part !== 'children') {
      break
    }
  }
  return {
    key: `${found.path.join('.')}:${found.code}`,
    text: t('editorPrototype.issue', {
      block: type === '' ? t('editorPrototype.canvasLabel') : title(type),
      problem: issue(found.code),
    }),
  }
}

async function save(): Promise<void> {
  if (saving.value) {
    return
  }
  const document = editor.document.value
  const checked = validateDocument(JSON.parse(JSON.stringify(document)))
  if (!checked.ok) {
    issues.value = checked.issues.map((found) => describe(found, document))
    return
  }
  saving.value = true
  issues.value = []
  try {
    await prototypeApi.save(document)
    editor.markSaved(document)
    toast.add({ title: t('editorPrototype.saved'), color: 'success', icon: 'i-lucide-circle-check' })
  } catch (caught) {
    const refused = caught instanceof ApiRequestError ? InvalidBlocksResponse.safeParse(caught.data) : undefined
    if (refused?.success === true) {
      issues.value = refused.data.issues.map((found) => describe(found, document))
    } else {
      toast.add({ title: t('editorPrototype.saveFailed'), color: 'error', icon: 'i-lucide-circle-x' })
    }
  } finally {
    saving.value = false
  }
}

function onKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void save()
  }
}

const blockCount = computed(() => flatten(editor.document.value).length)
</script>

<template>
  <UDashboardPanel id="editor-prototype">
    <template #header>
      <UDashboardNavbar :title="t('editorPrototype.title')" />
    </template>

    <template #body>
      <div class="mx-auto flex w-full max-w-3xl flex-col gap-4" @keydown="onKeydown">
        <UAlert
          v-if="!mayEdit"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="t('editorPrototype.denied')"
        />
        <UAlert
          v-else-if="status === 'error'"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="t('editorPrototype.loadFailed')"
          :actions="[{ label: t('editorPrototype.retry'), onClick: () => refresh() }]"
        />
        <UAlert
          v-else-if="storedInvalid"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="t('editorPrototype.previewPage.invalid')"
        />
        <template v-else>
          <div
            role="toolbar"
            :aria-label="t('editorPrototype.toolbarLabel')"
            class="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-default bg-default py-2"
          >
            <UButton
              icon="i-lucide-undo-2"
              color="neutral"
              variant="ghost"
              :aria-label="t('editorPrototype.undo')"
              aria-keyshortcuts="Control+Z"
              :disabled="!editor.canUndo.value"
              @click="editor.undo()"
            />
            <UButton
              icon="i-lucide-redo-2"
              color="neutral"
              variant="ghost"
              :aria-label="t('editorPrototype.redo')"
              aria-keyshortcuts="Control+Shift+Z"
              :disabled="!editor.canRedo.value"
              @click="editor.redo()"
            />
            <UButton
              to="/admin/editor-prototype/preview"
              external
              icon="i-lucide-eye"
              color="neutral"
              variant="outline"
              :label="t('editorPrototype.preview')"
            />
            <UButton
              icon="i-lucide-save"
              :label="t('editorPrototype.save')"
              :loading="saving"
              aria-keyshortcuts="Control+S"
              @click="save"
            />
          </div>
          <p class="text-sm text-muted">{{ t('editorPrototype.intro') }}</p>
          <p class="text-xs text-muted">{{ t('editorPrototype.shortcuts') }}</p>
          <p v-if="editor.dirty.value" class="text-xs text-warning" role="status">{{ t('editorPrototype.unsaved') }}</p>
          <UAlert
            v-if="issues.length > 0"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :title="t('editorPrototype.invalid')"
          >
            <template #description>
              <ul class="list-disc pl-4">
                <li v-for="found in issues" :key="found.key">{{ found.text }}</li>
              </ul>
            </template>
          </UAlert>
          <EditorCanvas :data-block-count="blockCount" />
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
