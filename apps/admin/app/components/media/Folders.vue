<script setup lang="ts">
import { MEDIA_FOLDER_NAME_MAX_LENGTH } from '@toascribe/shared'
import type { MediaFolderItem } from '@toascribe/shared'

// «Mapper» of the library (K-119): add a folder (at the top or inside another), rename it, move it, delete it. Deleting a folder deletes its
// subfolders too, and their files move to the top of the library; the files themselves are not touched. Folders are for sorting in the admin only: a file's
// address does not change with its folder.
const props = defineProps<{ folders: readonly MediaFolderItem[] }>()
const emit = defineEmits<{ close: [changed: boolean] }>()

const { t } = useI18n()
const mediaApi = useMediaApi()
const confirm = useConfirmDialog()
const uid = useId()

const list = ref<readonly MediaFolderItem[]>(props.folders)
const changed = ref(false)
const failure = ref<string>()

function errorText(caught: unknown): string {
  return mediaErrorText(t, caught instanceof ApiRequestError ? caught.code : undefined) ?? describeApiError(caught, t)
}

const NONE = 'none'
const parentItems = (except?: string) => {
  const below = new Set(except === undefined ? [] : [except])
  for (const folder of list.value) {
    if (folder.parentId !== null && below.has(folder.parentId)) below.add(folder.id)
  }
  return [
    { value: NONE, label: t('media.folders.top') },
    ...list.value
      .filter((folder) => !below.has(folder.id))
      .map((folder) => ({ value: folder.id, label: `${'   '.repeat(folder.depth)}${folder.name}` })),
  ]
}

const name = ref('')
const parent = ref(NONE)
const adding = ref(false)
async function add(): Promise<void> {
  if (adding.value || name.value.trim() === '') return
  adding.value = true
  failure.value = undefined
  try {
    const answer = await mediaApi.createFolder({
      name: name.value.trim(),
      ...(parent.value === NONE ? {} : { parentId: parent.value }),
    })
    list.value = answer.folders
    name.value = ''
    changed.value = true
  } catch (caught) {
    failure.value = errorText(caught)
  } finally {
    adding.value = false
  }
}

const editing = ref<string>()
const editName = ref('')
const editParent = ref(NONE)
function startEdit(folder: MediaFolderItem): void {
  editing.value = folder.id
  editName.value = folder.name
  editParent.value = folder.parentId ?? NONE
}
async function saveEdit(folder: MediaFolderItem): Promise<void> {
  const parentId = editParent.value === NONE ? null : editParent.value
  const request = {
    ...(editName.value.trim() !== folder.name ? { name: editName.value.trim() } : {}),
    ...(parentId !== folder.parentId ? { parentId } : {}),
  }
  if (Object.keys(request).length === 0 || editName.value.trim() === '') {
    editing.value = undefined
    return
  }
  failure.value = undefined
  try {
    list.value = (await mediaApi.updateFolder(folder.id, request)).folders
    editing.value = undefined
    changed.value = true
  } catch (caught) {
    failure.value = errorText(caught)
  }
}

async function remove(folder: MediaFolderItem): Promise<void> {
  const confirmed = await confirm.ask({
    title: t('media.folders.deleteTitle'),
    description: t('media.folders.deleteConfirm', { name: folder.name }),
    confirmLabel: t('media.folders.delete'),
    cancelLabel: t('content.quickEdit.cancel'),
    color: 'error',
  })
  if (!confirmed) return
  failure.value = undefined
  try {
    await mediaApi.removeFolder(folder.id)
    list.value = (await mediaApi.folders()).folders
    changed.value = true
  } catch (caught) {
    failure.value = errorText(caught)
  }
}
</script>

<template>
  <UModal :title="$t('media.folders.title')" :ui="{ footer: 'justify-end' }" @update:open="emit('close', changed)">
    <template #body>
      <div class="flex flex-col gap-6">
        <form class="flex flex-col gap-3" @submit.prevent="add">
          <UFormField :label="$t('media.folders.name')" :name="`${uid}-name`">
            <UInput
              v-model="name"
              size="xl"
              class="w-full"
              autocomplete="off"
              :maxlength="MEDIA_FOLDER_NAME_MAX_LENGTH"
            />
          </UFormField>
          <UFormField :label="$t('media.folders.parent')" :name="`${uid}-parent`">
            <USelect v-model="parent" :items="parentItems()" size="xl" class="w-full" />
          </UFormField>
          <div>
            <UButton type="submit" size="lg" class="min-h-11" :loading="adding">{{ $t('media.folders.add') }}</UButton>
          </div>
        </form>

        <UAlert
          v-if="failure"
          color="error"
          variant="subtle"
          role="alert"
          icon="i-lucide-triangle-alert"
          :title="$t('content.actionFailed')"
          :description="failure"
        />

        <p v-if="list.length === 0" class="text-sm text-toned">{{ $t('media.folders.empty') }}</p>
        <ul v-else class="flex flex-col divide-y divide-default rounded-md border border-default">
          <li v-for="folder in list" :key="folder.id" class="flex flex-col gap-2 p-3">
            <form v-if="editing === folder.id" class="flex flex-col gap-2" @submit.prevent="saveEdit(folder)">
              <UFormField :label="$t('media.folders.name')" :name="`${uid}-edit-name`">
                <UInput v-model="editName" size="xl" class="w-full" :maxlength="MEDIA_FOLDER_NAME_MAX_LENGTH" />
              </UFormField>
              <UFormField :label="$t('media.folders.parent')" :name="`${uid}-edit-parent`">
                <USelect v-model="editParent" :items="parentItems(folder.id)" size="xl" class="w-full" />
              </UFormField>
              <div class="flex gap-2">
                <UButton type="submit" size="lg" class="min-h-11">{{ $t('content.quickEdit.update') }}</UButton>
                <UButton color="neutral" variant="outline" size="lg" class="min-h-11" @click="editing = undefined">
                  {{ $t('content.quickEdit.cancel') }}
                </UButton>
              </div>
            </form>
            <div v-else class="flex flex-wrap items-center justify-between gap-2">
              <span class="min-w-0 font-medium text-highlighted wrap-anywhere">
                {{ '— '.repeat(folder.depth) }}{{ folder.name }}
                <span class="text-sm font-normal text-toned">({{ folder.count }})</span>
              </span>
              <span class="flex gap-1">
                <UButton
                  size="sm"
                  color="neutral"
                  variant="ghost"
                  class="min-h-11 lg:min-h-8"
                  :label="$t('content.actions.edit')"
                  :aria-label="$t('media.folders.editNamed', { name: folder.name })"
                  @click="startEdit(folder)"
                />
                <UButton
                  size="sm"
                  color="error"
                  variant="ghost"
                  class="min-h-11 lg:min-h-8"
                  :label="$t('media.folders.delete')"
                  :aria-label="$t('media.folders.deleteNamed', { name: folder.name })"
                  @click="remove(folder)"
                />
              </span>
            </div>
          </li>
        </ul>
      </div>
    </template>
    <template #footer>
      <UButton color="neutral" variant="outline" size="lg" class="min-h-11" @click="emit('close', changed)">
        {{ $t('media.details.close') }}
      </UButton>
    </template>
  </UModal>
</template>
