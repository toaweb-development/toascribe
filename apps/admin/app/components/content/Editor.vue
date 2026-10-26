<script setup lang="ts">
import type { BlockDocument } from '@toascribe/blocks'
import { flatten, validateDocument } from '@toascribe/blocks'
import { InvalidBlocksResponse } from '@toascribe/shared'
import type { ContentItem, ContentTypeKey } from '@toascribe/shared'

// «Legg til nytt» and «Rediger» (M1.1): the block editor of the M0.6 prototype on a real post or page, with a title field, saving
// through the content API. A new item is made on the first save (a draft) and the address becomes its own. The real editor, with the
// sidebar, comes in M1.3. Items from the install hold WordPress' parsed blocks until the data migration of M1.3: their title can be
// changed here, their blocks cannot.
const props = defineProps<{ type: ContentTypeKey; id?: string }>()

const { t } = useI18n()
const router = useRouter()
const auth = useAuth()
const contentApi = useContentApi()
const toast = useToast()
const { title: blockTitle, issue } = useBlockText()

const words = computed(() => typeText(t, props.type))
const capability = props.type === 'page' ? 'edit_pages' : 'edit_posts'
const mayEdit = computed(
  () => auth.session.value.status === 'authenticated' && auth.session.value.account.capabilities.includes(capability),
)
if (import.meta.server && !mayEdit.value) {
  const event = useRequestEvent()
  if (event) setResponseStatus(event, 403)
}

const editor = useBlockEditor()
provideBlockEditor(editor)
// The files the image blocks use: from the api with the item, and the ones picked in the library while editing.
const mediaRefs = provideMediaRefs()
function keepMedia(loaded: ContentItem): void {
  for (const entry of loaded.media) mediaRefs.value.set(entry.id, entry)
}

const { data, status, error, refresh } = await useAsyncData(
  `content:editor:${props.id ?? 'new'}`,
  async (): Promise<ContentItem | null> =>
    mayEdit.value && props.id !== undefined ? await contentApi.get(props.id) : null,
)

const title = ref('')
const savedTitle = ref('')
const legacy = ref(false)
const item = ref<ContentItem | null>(null)
watch(
  data,
  (loaded) => {
    if (loaded == null) return
    item.value = loaded
    keepMedia(loaded)
    title.value = loaded.title
    savedTitle.value = loaded.title
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
const dirty = computed(() => title.value !== savedTitle.value || (!legacy.value && editor.dirty.value))
useUnsavedGuard(() => dirty.value)

const saving = ref(false)
const issues = ref<{ key: string; text: string }[]>([])
const failure = ref<string>()

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

/** Saves the title and (unless the blocks are WordPress' parsed ones) the blocks; `publish` publishes afterwards. */
async function save(publish = false): Promise<void> {
  if (saving.value || readOnly.value) return
  const document = editor.document.value
  if (!legacy.value) {
    const checked = validateDocument(JSON.parse(JSON.stringify(document)))
    if (!checked.ok) {
      issues.value = checked.issues.map((found) => describe(found, document))
      return
    }
  }
  saving.value = true
  issues.value = []
  failure.value = undefined
  try {
    const blocks = legacy.value ? undefined : (JSON.parse(JSON.stringify(document)) as unknown[])
    let saved =
      item.value === null
        ? await contentApi.create({ type: props.type, title: title.value, ...(blocks === undefined ? {} : { blocks }) })
        : await contentApi.update(item.value.id, { title: title.value, ...(blocks === undefined ? {} : { blocks }) })
    // Kept at once: if the publish below fails, the next save changes this item instead of making a second one.
    item.value = saved
    keepMedia(saved)
    if (publish) {
      saved = await contentApi.publish(saved.id)
      item.value = saved
    }
    savedTitle.value = saved.title
    if (!legacy.value) editor.markSaved(document)
    toast.add({
      title: publish ? t('content.editor.published') : t('content.editor.saved'),
      color: 'success',
      icon: 'i-lucide-circle-check',
    })
    if (props.id === undefined) {
      await router.replace(`/${props.type === 'page' ? 'pages' : 'posts'}/${saved.id}`)
    }
  } catch (caught) {
    const refused = caught instanceof ApiRequestError ? InvalidBlocksResponse.safeParse(caught.data) : undefined
    if (refused?.success === true) {
      issues.value = refused.data.issues.map((found) => describe(found, document))
    } else {
      failure.value =
        contentErrorText(t, caught instanceof ApiRequestError ? caught.code : undefined) ?? describeApiError(caught, t)
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

const mayPublish = computed(() =>
  item.value === null
    ? auth.session.value.status === 'authenticated' &&
      auth.session.value.account.capabilities.includes(props.type === 'page' ? 'publish_pages' : 'publish_posts')
    : item.value.can.publish && !['publish', 'future', 'private'].includes(item.value.status),
)
const heading = computed(() => (props.id === undefined ? words.value.addTitle : words.value.edit))
const blockCount = computed(() => flatten(editor.document.value).length)
const statusText = computed(() =>
  item.value === null || item.value.status === 'trash' ? '' : statusLabel(t, item.value.status),
)
</script>

<template>
  <UDashboardPanel :id="`content-editor-${type}`">
    <template #header>
      <UDashboardNavbar :title="heading" />
    </template>

    <template #body>
      <div class="mx-auto flex w-full max-w-3xl flex-col gap-4" @keydown="onKeydown">
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
          <UAlert
            v-if="readOnly"
            color="warning"
            variant="subtle"
            icon="i-lucide-lock"
            :title="item?.status === 'trash' ? $t('content.errors.trashed') : $t('content.editor.readOnly')"
          />
          <div
            role="toolbar"
            :aria-label="$t('editorPrototype.toolbarLabel')"
            class="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-default bg-default py-2"
          >
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
            <UButton
              v-if="item"
              :to="`/preview/${item.id}`"
              icon="i-lucide-eye"
              color="neutral"
              variant="outline"
              :label="$t('content.actions.preview')"
            />
            <span v-if="statusText !== ''" class="text-sm text-toned">{{
              $t('content.editor.status', { status: statusText })
            }}</span>
            <span class="flex-1" />
            <UButton
              icon="i-lucide-save"
              color="neutral"
              variant="outline"
              :label="
                item && item.status !== 'draft' && item.status !== 'pending'
                  ? $t('content.editor.update')
                  : $t('content.editor.saveDraft')
              "
              :loading="saving"
              :disabled="readOnly"
              aria-keyshortcuts="Control+S"
              @click="save()"
            />
            <UButton
              v-if="mayPublish && !readOnly"
              icon="i-lucide-send"
              :label="$t('content.editor.publish')"
              :loading="saving"
              @click="save(true)"
            />
          </div>

          <UFormField :label="$t('content.editor.title')" name="title">
            <UInput
              v-model="title"
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
          <template v-else-if="!readOnly">
            <p class="text-xs text-muted">{{ $t('editorPrototype.shortcuts') }}</p>
            <EditorCanvas :data-block-count="blockCount" />
          </template>
          <article v-else class="rounded-md border border-default p-4 sm:p-6">
            <BlocksDocument :blocks="item?.blocks ?? []" />
          </article>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
