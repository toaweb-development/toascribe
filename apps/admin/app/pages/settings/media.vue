<script setup lang="ts">
import { DEFAULT_ROLES, MEDIA_GROUPS } from '@toascribe/shared'
import type { MediaGroup, MediaSettings, UpdateMediaSettingsRequest } from '@toascribe/shared'

// «Innstillinger → Media» (M1.2; WordPress' options-media.php): the three image sizes and the thumbnail crop, the year-and-month folders,
// and what WordPress leaves to plugins: the largest upload (never above UPLOAD_MAX_SIZE_MB, which the proxy enforces), the most pixels an
// image may have before it is decoded, and which types each role may upload (K-125). A change of the sizes applies to new uploads;
// «Lag bildestørrelser på nytt» makes them again for the files already there. Needs `manage_options`.
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t } = useI18n()
const auth = useAuth()
const mediaApi = useMediaApi()
const confirm = useConfirmDialog()
useSeoMeta({ title: () => t('media.settings.title') })

const mayManage = computed(
  () =>
    auth.session.value.status === 'authenticated' && auth.session.value.account.capabilities.includes('manage_options'),
)
if (import.meta.server && !mayManage.value) {
  const event = useRequestEvent()
  if (event) setResponseStatus(event, 403)
}

const { data, error, refresh } = await useAsyncData('settings:media', async () =>
  mayManage.value ? await mediaApi.settings() : null,
)

/** The roles that may upload at all: the only ones the type choice means anything for. */
const UPLOAD_ROLES = DEFAULT_ROLES.filter((role) => role.capabilities.includes('upload_files')).map((role) => role.slug)

const form = reactive({
  thumbnail_size_w: 0,
  thumbnail_size_h: 0,
  thumbnail_crop: true,
  medium_size_w: 0,
  medium_size_h: 0,
  large_size_w: 0,
  large_size_h: 0,
  uploads_use_yearmonth_folders: true,
  upload_max_size_mb: 64,
  /** Megapixels in the field; pixels in the setting. */
  megapixels: 100,
  groups: {} as Record<string, MediaGroup[]>,
})
function fill(settings: MediaSettings): void {
  Object.assign(form, {
    thumbnail_size_w: settings.thumbnail_size_w,
    thumbnail_size_h: settings.thumbnail_size_h,
    thumbnail_crop: settings.thumbnail_crop,
    medium_size_w: settings.medium_size_w,
    medium_size_h: settings.medium_size_h,
    large_size_w: settings.large_size_w,
    large_size_h: settings.large_size_h,
    uploads_use_yearmonth_folders: settings.uploads_use_yearmonth_folders,
    upload_max_size_mb: settings.upload_max_size_mb,
    megapixels: Math.round(settings.image_max_pixels / 1_000_000),
    groups: Object.fromEntries(
      UPLOAD_ROLES.map((role) => [role, [...(settings.upload_groups_by_role[role] ?? MEDIA_GROUPS)]]),
    ),
  })
}
watch(data, (loaded) => loaded && fill(loaded.settings), { immediate: true })

function toggleGroup(role: string, group: MediaGroup, on: boolean | 'indeterminate'): void {
  const current = form.groups[role] ?? []
  form.groups[role] = on === true ? [...new Set([...current, group])] : current.filter((entry) => entry !== group)
}

const saving = ref(false)
const report = ref<string>()
const failure = ref<string>()
const sizesChanged = ref(false)

function errorText(caught: unknown): string {
  return mediaErrorText(t, caught instanceof ApiRequestError ? caught.code : undefined) ?? describeApiError(caught, t)
}

async function save(): Promise<void> {
  const before = data.value?.settings
  if (!before || saving.value) return
  // Every type is the same as no rule: the role's key is left out, so a type added later is allowed too. Roles not shown keep theirs.
  const shown = new Set<string>(UPLOAD_ROLES)
  const byRole: Record<string, MediaGroup[]> = Object.fromEntries(
    Object.entries(before.upload_groups_by_role).filter(([role]) => !shown.has(role)),
  )
  for (const role of UPLOAD_ROLES) {
    const chosen = MEDIA_GROUPS.filter((group) => form.groups[role]?.includes(group))
    if (chosen.length < MEDIA_GROUPS.length) byRole[role] = chosen
  }
  const next: MediaSettings = {
    thumbnail_size_w: form.thumbnail_size_w,
    thumbnail_size_h: form.thumbnail_size_h,
    thumbnail_crop: form.thumbnail_crop,
    medium_size_w: form.medium_size_w,
    medium_size_h: form.medium_size_h,
    large_size_w: form.large_size_w,
    large_size_h: form.large_size_h,
    uploads_use_yearmonth_folders: form.uploads_use_yearmonth_folders,
    upload_max_size_mb: form.upload_max_size_mb,
    image_max_pixels: form.megapixels * 1_000_000,
    upload_groups_by_role: byRole,
  }
  const request: UpdateMediaSettingsRequest = Object.fromEntries(
    Object.entries(next).filter(
      ([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key as keyof MediaSettings]),
    ),
  )
  if (Object.keys(request).length === 0) {
    report.value = t('media.settings.saved')
    return
  }
  saving.value = true
  failure.value = undefined
  report.value = undefined
  try {
    await mediaApi.updateSettings(request)
    sizesChanged.value = Object.keys(request).some((key) => /_size_|thumbnail_crop/.test(key))
    report.value = t('media.settings.saved')
    await refresh()
  } catch (caught) {
    failure.value = errorText(caught)
  } finally {
    saving.value = false
  }
}

const regenerating = ref(false)
async function regenerateAll(): Promise<void> {
  const confirmed = await confirm.ask({
    title: t('media.settings.regenerateTitle'),
    description: t('media.settings.regenerateConfirm'),
    confirmLabel: t('media.settings.regenerate'),
    cancelLabel: t('content.quickEdit.cancel'),
  })
  if (!confirmed) return
  regenerating.value = true
  failure.value = undefined
  try {
    const { queued } = await mediaApi.regenerate()
    sizesChanged.value = false
    report.value = t('media.settings.regenerateQueued', { n: queued }, queued)
  } catch (caught) {
    failure.value = errorText(caught)
  } finally {
    regenerating.value = false
  }
}

const SIZES = [
  { key: 'thumbnail', w: 'thumbnail_size_w', h: 'thumbnail_size_h' },
  { key: 'medium', w: 'medium_size_w', h: 'medium_size_h' },
  { key: 'large', w: 'large_size_w', h: 'large_size_h' },
] as const
const sizeLabel = (key: (typeof SIZES)[number]['key']) =>
  key === 'thumbnail'
    ? t('media.settings.thumbnail')
    : key === 'medium'
      ? t('media.settings.medium')
      : t('media.settings.large')
</script>

<template>
  <UDashboardPanel id="settings-media">
    <template #header>
      <UDashboardNavbar :title="$t('media.settings.title')" />
    </template>
    <template #body>
      <section v-if="!mayManage" aria-labelledby="settings-denied-heading" class="flex max-w-prose flex-col gap-3">
        <h2 id="settings-denied-heading" class="text-xl font-semibold text-highlighted">
          {{ $t('media.settings.denied') }}
        </h2>
        <p class="text-base text-default">{{ $t('content.denied.text') }}</p>
      </section>
      <UAlert
        v-else-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :title="$t('media.settings.loadFailed')"
        :actions="[{ label: $t('content.failed.retry'), onClick: () => refresh() }]"
      />
      <form v-else-if="data" class="flex max-w-3xl flex-col gap-8" @submit.prevent="save">
        <section aria-labelledby="settings-sizes" class="flex flex-col gap-4">
          <h2 id="settings-sizes" class="text-lg font-semibold text-highlighted">{{ $t('media.settings.sizes') }}</h2>
          <p class="text-sm text-toned">{{ $t('media.settings.sizesHelp') }}</p>
          <fieldset v-for="size in SIZES" :key="size.key" class="flex flex-col gap-3">
            <legend class="mb-2 font-semibold text-highlighted">{{ sizeLabel(size.key) }}</legend>
            <div class="grid grid-cols-2 gap-3 sm:max-w-md">
              <UFormField :label="$t('media.settings.width')" :name="size.w">
                <UInput v-model.number="form[size.w]" type="number" min="0" max="10000" size="xl" class="w-full" />
              </UFormField>
              <UFormField :label="$t('media.settings.height')" :name="size.h">
                <UInput v-model.number="form[size.h]" type="number" min="0" max="10000" size="xl" class="w-full" />
              </UFormField>
            </div>
            <UCheckbox
              v-if="size.key === 'thumbnail'"
              v-model="form.thumbnail_crop"
              :label="$t('media.settings.thumbnailCrop')"
            />
          </fieldset>
          <div class="flex flex-col items-start gap-2">
            <UButton
              color="neutral"
              variant="outline"
              size="lg"
              class="min-h-11"
              icon="i-lucide-refresh-cw"
              :loading="regenerating"
              :label="$t('media.settings.regenerate')"
              @click="regenerateAll"
            />
            <p v-if="sizesChanged" class="text-sm text-warning" role="status">
              {{ $t('media.settings.sizesChanged') }}
            </p>
          </div>
        </section>

        <section aria-labelledby="settings-uploads" class="flex flex-col gap-4">
          <h2 id="settings-uploads" class="text-lg font-semibold text-highlighted">
            {{ $t('media.settings.uploads') }}
          </h2>
          <UCheckbox v-model="form.uploads_use_yearmonth_folders" :label="$t('media.settings.yearMonth')" />
          <UFormField
            :label="$t('media.settings.maxSize')"
            :help="$t('media.settings.maxSizeHelp', { cap: data.uploadMaxSizeCapMb })"
            name="upload_max_size_mb"
          >
            <UInput
              v-model.number="form.upload_max_size_mb"
              type="number"
              min="1"
              :max="data.uploadMaxSizeCapMb"
              size="xl"
              class="w-full sm:w-48"
            />
          </UFormField>
          <UFormField
            :label="$t('media.settings.maxPixels')"
            :help="$t('media.settings.maxPixelsHelp')"
            name="image_max_pixels"
          >
            <UInput
              v-model.number="form.megapixels"
              type="number"
              min="1"
              max="1000"
              size="xl"
              class="w-full sm:w-48"
            />
          </UFormField>
        </section>

        <section aria-labelledby="settings-types" class="flex flex-col gap-4">
          <h2 id="settings-types" class="text-lg font-semibold text-highlighted">{{ $t('media.settings.types') }}</h2>
          <p class="text-sm text-toned">{{ $t('media.settings.typesHelp') }}</p>
          <fieldset v-for="role in UPLOAD_ROLES" :key="role" class="flex flex-col gap-2">
            <legend class="mb-2 font-semibold text-highlighted">{{ roleLabel($t, role, undefined) }}</legend>
            <div class="flex flex-wrap gap-x-5 gap-y-2">
              <UCheckbox
                v-for="group in MEDIA_GROUPS"
                :key="group"
                :model-value="form.groups[role]?.includes(group) ?? false"
                :label="groupLabel($t, group)"
                @update:model-value="toggleGroup(role, group, $event)"
              />
            </div>
          </fieldset>
        </section>

        <div role="status">
          <UAlert v-if="report" color="success" variant="subtle" icon="i-lucide-circle-check" :title="report" />
        </div>
        <UAlert
          v-if="failure"
          color="error"
          variant="subtle"
          role="alert"
          icon="i-lucide-triangle-alert"
          :title="$t('media.settings.saveFailed')"
          :description="failure"
        />
        <div>
          <UButton type="submit" size="lg" class="min-h-11" :loading="saving">{{ $t('media.settings.save') }}</UButton>
        </div>
      </form>
    </template>
  </UDashboardPanel>
</template>
