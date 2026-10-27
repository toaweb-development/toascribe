<script setup lang="ts">
import type { BlockDocument } from '@toascribe/blocks'
import { flatten, locate, validateDocument } from '@toascribe/blocks'
import { InvalidBlocksResponse } from '@toascribe/shared'
import type { ContentAuthorRef, ContentItem, ContentTypeKey, TermItem } from '@toascribe/shared'

import { ContentLoginModal, ContentShortcutsModal } from '#components'
import type { EditorForm, FormRights, MainAction } from '~/utils/editor-form'

// «Legg til nytt» and «Rediger» (M1.3, PLAN «Redigeringsskjermen», WordPress' block editor): the top bar (the inserter, undo and redo,
// «Lagre utkast», «Forhåndsvis», «Publiser» / «Planlegg» / «Oppdater» or, for a contributor, «Send til gjennomgang», the sidebar and
// «Hurtigtaster»), the title, the block canvas, and the sidebar with the «Innlegg»/«Side» tab and the «Blokk» tab. A new item is made on
// the first save (a draft) and the address becomes its own. When the session runs out, a login dialog opens over the editor and the
// save that found it goes on afterwards (K-010); leaving with unsaved changes asks first. Autosave and revisions are phase 2.
const props = defineProps<{ type: ContentTypeKey; id?: string }>()

const { t } = useI18n()
const router = useRouter()
const auth = useAuth()
const contentApi = useContentApi()
const termsApi = useTermsApi()
const toast = useToast()
const overlay = useOverlay()
const confirm = useConfirmDialog()
const { title: blockTitle, issue } = useBlockText()

const words = computed(() => typeText(t, props.type))
// The rights and the account of the last signed-in session: a 401 (the session ran out) makes useAuth forget the session, and the
// editor must stay as it is behind the login dialog, with the work that is not saved (K-010). The api stays the authority.
const signedIn = shallowRef<{ id: string; capabilities: readonly string[] }>({ id: '', capabilities: [] })
watch(
  () => auth.session.value,
  (session) => {
    if (session.status === 'authenticated') {
      signedIn.value = { id: session.account.id, capabilities: session.account.capabilities }
    }
  },
  { immediate: true },
)
const capabilities = computed<ReadonlySet<string>>(() => new Set(signedIn.value.capabilities))
const plural = props.type === 'page' ? 'pages' : 'posts'
const mayEdit = computed(() => capabilities.value.has(`edit_${plural}`))
if (import.meta.server && !mayEdit.value) {
  const event = useRequestEvent()
  if (event) setResponseStatus(event, 403)
}
const accountId = computed(() => signedIn.value.id)

const editor = useBlockEditor()
provideBlockEditor(editor)
watch(capabilities, (caps) => editor.setScope({ capabilities: caps, contentType: props.type }), { immediate: true })
// The files the image blocks, the featured image and the sharing image use: from the api with the item, and the ones picked meanwhile.
const mediaRefs = provideMediaRefs()
function keepMedia(loaded: ContentItem): void {
  for (const entry of loaded.media) mediaRefs.value.set(entry.id, entry)
}

const { data, status, error, refresh } = await useAsyncData(
  `content:editor:${props.id ?? 'new'}`,
  async (): Promise<ContentItem | null> =>
    mayEdit.value && props.id !== undefined ? await contentApi.get(props.id) : null,
)
// Posts: every category, for the sidebar (read once with the page).
const { data: categoryTerms } = await useAsyncData(
  `content:editor:categories:${props.type}`,
  async (): Promise<TermItem[]> =>
    props.type === 'post' && mayEdit.value ? await termsApi.all('category').catch(() => []) : [],
)

const legacy = ref(false)
const item = ref<ContentItem | null>(null)
const form = ref<EditorForm>(formOf(null, accountId.value))
const savedForm = ref(JSON.stringify(form.value))
watch(
  data,
  (loaded) => {
    if (loaded == null) return
    item.value = loaded
    keepMedia(loaded)
    form.value = formOf(loaded, accountId.value)
    savedForm.value = JSON.stringify(form.value)
    const checked = validateDocument(loaded.blocks)
    legacy.value = loaded.blocksFormat === 'legacy' || !checked.ok
    editor.load(checked.ok ? checked.blocks : [])
  },
  { immediate: true },
)

const notFound = computed(
  () => props.id !== undefined && error.value instanceof ApiRequestError && error.value.status === 404,
)
const readOnly = computed(() => item.value !== null && (!item.value.can.edit || item.value.status === 'trash'))
const rights = computed<FormRights>(() =>
  item.value === null
    ? {
        publish: capabilities.value.has(`publish_${plural}`),
        editOthers: capabilities.value.has(`edit_others_${plural}`),
      }
    : { publish: item.value.can.publish, editOthers: item.value.can.editOthers },
)
const dirty = computed(() => JSON.stringify(form.value) !== savedForm.value || (!legacy.value && editor.dirty.value))
useUnsavedGuard(() => dirty.value)

// --- Authors and parents for the sidebar, read when it first needs them -------------------------------------------------------
const authors = ref<ContentAuthorRef[]>([])
const parents = ref<{ id: string; label: string }[]>([])
onMounted(async () => {
  if (rights.value.editOthers) {
    authors.value = (await contentApi.authors(props.type).catch(() => ({ authors: [] }))).authors
  }
  if (props.type === 'page') {
    const tree = await contentApi.list({ type: 'page', per_page: 100 }).catch(() => undefined)
    const below = new Set<string>(props.id === undefined ? [] : [props.id])
    for (const entry of tree?.items ?? []) if (entry.parentId !== null && below.has(entry.parentId)) below.add(entry.id)
    parents.value = (tree?.items ?? [])
      .filter((entry) => !below.has(entry.id))
      .map((entry) => ({ id: entry.id, label: `${depthPrefix(entry.depth)}${titleOf(t, entry.title)}` }))
  }
})

// --- Saving --------------------------------------------------------------------------------------------------------------------
const saving = ref(false)
const issues = ref<{ key: string; text: string }[]>([])
const failure = ref<string>()
const now = ref(new Date())
const action = computed<MainAction>(() => mainAction(item.value, form.value, rights.value.publish, now.value))
const actionLabel = computed(() => {
  switch (action.value) {
    case 'schedule':
      return t('editor.actions.schedule')
    case 'update':
      return t('content.editor.update')
    case 'submit':
      return t('editor.actions.submit')
    default:
      return t('content.editor.publish')
  }
})

function describe(
  found: { readonly path: readonly (string | number)[]; readonly code: string },
  document: BlockDocument,
) {
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
      block: type === '' ? t('editorPrototype.canvasLabel') : blockTitle(type),
      problem: issue(found.code),
    }),
  }
}

/** A save that found the session gone: it runs again once the person has signed in in the dialog (K-010). */
let pendingSave: MainAction | 'draft' | undefined
const inline = useInlineLogin()
inline.hold()
const loginDialog = overlay.create(ContentLoginModal)
watch(inline.needed, async (needed) => {
  if (!needed) return
  const before = accountId.value
  const back = (await loginDialog.open()) as boolean | undefined
  inline.needed.value = false
  if (back !== true) return
  const now = auth.session.value.status === 'authenticated' ? auth.session.value.account.id : ''
  const again = pendingSave
  pendingSave = undefined
  if (now !== before) {
    // Another account signed in: its session must not send the first account's work. The page shows what the new one may see.
    toast.add({ title: t('editor.login.otherAccount'), color: 'warning', icon: 'i-lucide-triangle-alert' })
    if (item.value === null) {
      // A new item that was never saved: nothing to read again, so it starts empty for the new account.
      form.value = formOf(null, now)
      savedForm.value = JSON.stringify(form.value)
      editor.load([])
    } else {
      await refresh()
    }
    return
  }
  toast.add({
    title: previewWaits ? t('editor.login.previewAgain') : t('editor.login.done'),
    color: 'success',
    icon: 'i-lucide-circle-check',
  })
  previewWaits = false
  if (again !== undefined) await save(again)
})
// The dialog is not closed by the overlay when the editor goes; close it here.
onBeforeUnmount(() => loginDialog.close())

/** Saves the form and (unless the blocks are WordPress' parsed ones) the blocks, with the status the button says. */
async function save(kind: MainAction | 'draft'): Promise<boolean> {
  if (saving.value || readOnly.value) return false
  now.value = new Date()
  const document = editor.document.value
  if (!legacy.value) {
    const checked = validateDocument(JSON.parse(JSON.stringify(document)))
    if (!checked.ok) {
      issues.value = checked.issues.map((found) => describe(found, document))
      return false
    }
  }
  saving.value = true
  issues.value = []
  failure.value = undefined
  try {
    const blocks = legacy.value ? undefined : (JSON.parse(JSON.stringify(document)) as unknown[])
    const request = requestOf(form.value, {
      type: props.type,
      item: item.value,
      action: kind,
      rights: rights.value,
      ...(blocks === undefined ? {} : { blocks }),
    })
    const saved =
      item.value === null
        ? await contentApi.create({ type: props.type, ...request })
        : await contentApi.update(item.value.id, request)
    item.value = saved
    keepMedia(saved)
    form.value = { ...formOf(saved, accountId.value), password: '' }
    savedForm.value = JSON.stringify(form.value)
    if (!legacy.value) editor.markSaved(document)
    toast.add({ title: savedMessage(kind, saved.status), color: 'success', icon: 'i-lucide-circle-check' })
    if (props.id === undefined) {
      await router.replace(`/${plural}/${saved.id}`)
    }
    return true
  } catch (caught) {
    if (caught instanceof ApiRequestError && caught.status === 401) {
      pendingSave = kind
      failure.value = t('editor.login.saveWaits')
      return false
    }
    const refused = caught instanceof ApiRequestError ? InvalidBlocksResponse.safeParse(caught.data) : undefined
    if (refused?.success === true) {
      issues.value = refused.data.issues.map((found) => describe(found, document))
    } else {
      failure.value =
        contentErrorText(t, caught instanceof ApiRequestError ? caught.code : undefined) ?? describeApiError(caught, t)
    }
    return false
  } finally {
    saving.value = false
  }
}

function savedMessage(kind: MainAction | 'draft', saved: string): string {
  if (kind === 'submit') return t('editor.saved.submitted')
  if (saved === 'future') return t('editor.saved.scheduled')
  if (kind === 'draft') return t('content.editor.saved')
  return t('content.editor.published')
}

/** «Forhåndsvis» found the session gone: after the login dialog, the person is asked to press it again (a new tab needs a click). */
let previewWaits = false

async function preview(): Promise<void> {
  // The window is opened in the click itself, before anything is awaited: a window opened after an await is blocked as a pop-up.
  const target = window.open('about:blank', '_blank')
  // With the session gone the preview would show the login screen in that tab: close it, and sign in again here first.
  const session = await auth.refresh().catch(() => undefined)
  if (session?.status !== 'authenticated') {
    target?.close()
    previewWaits = true
    inline.needed.value = true
    return
  }
  if (item.value === null || dirty.value) {
    if (!maySaveDraft(item.value) || !(await save('draft'))) {
      if (pendingSave !== undefined) {
        target?.close()
        return
      }
      if (item.value !== null && dirty.value) toast.add({ title: t('editor.previewSaveFirst'), color: 'warning' })
      if (item.value === null) {
        target?.close()
        return
      }
    }
  }
  if (item.value !== null && target !== null) target.location.href = `${baseURL}/preview/${item.value.id}`
}

async function trash(): Promise<void> {
  if (item.value === null) return
  const ok = await confirm.ask({
    title: t('editor.document.trash'),
    description: t('editor.trashConfirm'),
    confirmLabel: t('editor.document.trash'),
    cancelLabel: t('content.quickEdit.cancel'),
    color: 'error',
  })
  if (!ok) return
  try {
    await contentApi.trash(item.value.id)
    savedForm.value = JSON.stringify(form.value)
    editor.markSaved(editor.document.value)
    await router.push(`/${plural}`)
  } catch (caught) {
    failure.value = describeApiError(caught, t)
  }
}

// --- The top bar, the sidebar and the keys ------------------------------------------------------------------------------------
const sidebarOpen = ref(true)
const tab = ref<'document' | 'block'>('document')
watch(editor.selectedId, (id) => {
  if (id !== null && sidebarOpen.value) tab.value = 'block'
})
const tabs = computed(() => [
  { label: words.value.singular, value: 'document' },
  { label: t('editor.blockTab'), value: 'block' },
])
const shortcutsDialog = overlay.create(ContentShortcutsModal)
const baseURL = useRuntimeConfig().app.baseURL.replace(/\/$/, '')

/** Where the top bar's «+» puts a block: after the selected top-level block, or at the end. */
const topPlace = computed(() => {
  const id = editor.selectedId.value
  const located = id === null ? undefined : locate(editor.document.value, id)
  return located?.parentId === null
    ? { parentId: null, index: located.index + 1 }
    : { parentId: null, index: editor.document.value.length }
})

function onKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void save(maySaveDraft(item.value) ? 'draft' : 'update')
  }
}

const heading = computed(() => (props.id === undefined ? words.value.addTitle : words.value.edit))
const blockCount = computed(() => flatten(editor.document.value).length)
const path = computed(() => (item.value === null ? '/' : item.value.shortLink))
</script>

<template>
  <UDashboardPanel :id="`content-editor-${type}`">
    <template #header>
      <UDashboardNavbar :title="heading" />
    </template>

    <template #body>
      <div class="flex w-full flex-col gap-4" @keydown="onKeydown">
        <UAlert v-if="!mayEdit" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="words.denied" />
        <UAlert
          v-else-if="notFound"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="$t('content.errors.notFound')"
        />
        <UAlert
          v-else-if="status === 'error'"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="$t('content.editor.loadFailed')"
          :actions="[{ label: $t('content.failed.retry'), onClick: () => refresh() }]"
        />
        <template v-else>
          <div
            role="toolbar"
            :aria-label="$t('editorPrototype.toolbarLabel')"
            class="z-10 flex flex-wrap items-center gap-2 border-b border-default bg-default py-2 lg:sticky lg:top-0"
          >
            <EditorInserter
              v-if="!legacy && !readOnly"
              :place="topPlace"
              :parent-type="null"
              :label="$t('editor.addBlock')"
            />
            <UButton
              icon="i-lucide-undo-2"
              color="neutral"
              variant="ghost"
              :aria-label="$t('editorPrototype.undo')"
              aria-keyshortcuts="Control+Z"
              :disabled="!editor.canUndo.value || legacy"
              @click="editor.undo()"
            />
            <UButton
              icon="i-lucide-redo-2"
              color="neutral"
              variant="ghost"
              :aria-label="$t('editorPrototype.redo')"
              aria-keyshortcuts="Control+Shift+Z"
              :disabled="!editor.canRedo.value || legacy"
              @click="editor.redo()"
            />
            <span class="flex-1" />
            <UButton
              v-if="maySaveDraft(item)"
              color="neutral"
              variant="ghost"
              :label="$t('content.editor.saveDraft')"
              :loading="saving"
              :disabled="readOnly"
              aria-keyshortcuts="Control+S"
              @click="save('draft')"
            />
            <UButton
              icon="i-lucide-eye"
              color="neutral"
              variant="outline"
              :label="$t('content.actions.preview')"
              :disabled="saving"
              @click="preview"
            />
            <UButton
              v-if="!readOnly"
              :icon="action === 'schedule' ? 'i-lucide-calendar-clock' : 'i-lucide-send'"
              :label="actionLabel"
              :loading="saving"
              :aria-keyshortcuts="maySaveDraft(item) ? undefined : 'Control+S'"
              @click="save(action)"
            />
            <UButton
              icon="i-lucide-panel-right"
              color="neutral"
              :variant="sidebarOpen ? 'soft' : 'ghost'"
              :aria-label="$t('editor.sidebar')"
              :aria-pressed="sidebarOpen"
              aria-controls="editor-sidebar"
              @click="sidebarOpen = !sidebarOpen"
            />
            <UButton
              icon="i-lucide-keyboard"
              color="neutral"
              variant="ghost"
              :aria-label="$t('editor.shortcuts.title')"
              @click="shortcutsDialog.open()"
            />
          </div>

          <div class="flex flex-col gap-6 lg:flex-row lg:items-start">
            <div class="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4">
              <UAlert
                v-if="readOnly"
                color="warning"
                variant="subtle"
                icon="i-lucide-lock"
                :title="item?.status === 'trash' ? $t('content.errors.trashed') : $t('content.editor.readOnly')"
              />
              <UFormField :label="$t('content.editor.title')" name="title">
                <UInput
                  v-model="form.title"
                  size="xl"
                  class="w-full"
                  autocomplete="off"
                  :disabled="readOnly"
                  :placeholder="$t('content.editor.titlePlaceholder')"
                />
              </UFormField>
              <p v-if="item" class="text-sm text-toned">
                {{ $t('content.editor.shortLink') }} <code>{{ item.shortLink }}</code>
              </p>
              <p v-if="dirty" class="text-xs text-warning" role="status">{{ $t('editorPrototype.unsaved') }}</p>
              <UAlert
                v-if="failure"
                color="error"
                variant="subtle"
                role="alert"
                icon="i-lucide-triangle-alert"
                :title="$t('content.editor.saveFailed')"
                :description="failure"
              />
              <UAlert
                v-if="issues.length > 0"
                color="error"
                variant="subtle"
                icon="i-lucide-triangle-alert"
                :title="$t('editorPrototype.invalid')"
              >
                <template #description>
                  <ul class="list-disc pl-4">
                    <li v-for="found in issues" :key="found.key">{{ found.text }}</li>
                  </ul>
                </template>
              </UAlert>
              <UAlert
                v-if="legacy"
                color="info"
                variant="subtle"
                icon="i-lucide-info"
                :title="$t('content.editor.legacy')"
              />
              <EditorCanvas v-else-if="!readOnly" :data-block-count="blockCount" />
              <article v-else class="rounded-md border border-default p-4 sm:p-6">
                <BlocksDocument :blocks="item?.blocks ?? []" />
              </article>
            </div>

            <aside
              v-if="sidebarOpen"
              id="editor-sidebar"
              :aria-label="$t('editor.sidebar')"
              class="flex w-full shrink-0 flex-col gap-4 rounded-md border border-default p-4 lg:sticky lg:top-16 lg:max-h-[calc(100vh-6rem)] lg:w-80 lg:overflow-y-auto"
            >
              <UTabs v-model="tab" :items="tabs" :content="false" color="neutral" variant="link" class="w-full" />
              <ContentDocumentPanel
                v-if="tab === 'document'"
                v-model="form"
                :type="type"
                :item="item"
                :rights="rights"
                :authors="authors"
                :parents="parents"
                :categories="categoryTerms ?? []"
                :path="path"
                :read-only="readOnly"
                @trash="trash"
              />
              <EditorBlockSettings v-else />
            </aside>
          </div>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
