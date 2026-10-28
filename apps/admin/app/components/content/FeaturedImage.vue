<script setup lang="ts">
import { MediaPicker } from '#components'

// An image from the media library for the sidebar: «Fremhevet bilde» (K-070) and the SEO panel's sharing image. Stores the id only; the
// address comes from the library (useMediaRefs), so a replaced or edited file shows at once.
// `preview: false` leaves the picture to the caller (the profile draws it from the api's address, M1.8): no image, no «missing».
const props = withDefaults(defineProps<{ label: string; help?: string; chooseLabel?: string; preview?: boolean }>(), {
  help: undefined,
  chooseLabel: undefined,
  preview: true,
})
const mediaId = defineModel<string | null>({ required: true })

const mediaRefs = useMediaRefs()
const overlay = useOverlay()
const { t } = useI18n()
const pickerDialog = overlay.create(MediaPicker)
const image = computed(() => (mediaId.value === null ? undefined : mediaRefs.value.get(mediaId.value)))

async function pick(): Promise<void> {
  const item = await pickerDialog.open({ current: mediaId.value ?? undefined })
  if (!item) return
  mediaRefs.value.set(item.id, refOfItem(item))
  mediaId.value = item.id
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <p class="text-sm font-medium text-default">{{ props.label }}</p>
    <p v-if="help" class="text-xs text-muted">{{ help }}</p>
    <template v-if="mediaId !== null">
      <!-- eslint-disable vue/html-self-closing -->
      <template v-if="props.preview">
        <img v-if="image" :src="image.url" :alt="image.alt" class="h-auto max-h-48 w-full rounded-md object-cover" />
        <!-- eslint-enable vue/html-self-closing -->
        <p v-else class="text-sm text-warning">{{ t('editorPrototype.image.missing') }}</p>
      </template>
      <div class="flex flex-wrap gap-2">
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          class="min-h-11"
          :label="t('editor.featured.replace')"
          @click="pick"
        />
        <UButton
          color="error"
          variant="ghost"
          size="sm"
          class="min-h-11"
          :label="t('editor.featured.remove')"
          @click="mediaId = null"
        />
      </div>
    </template>
    <UButton
      v-else
      icon="i-lucide-image"
      color="neutral"
      variant="outline"
      class="min-h-11 self-start"
      :label="props.chooseLabel ?? t('editor.featured.choose')"
      @click="pick"
    />
  </div>
</template>
