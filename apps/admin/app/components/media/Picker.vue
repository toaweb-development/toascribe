<script setup lang="ts">
import type { MediaItem } from '@toascribe/shared'

// The editor's image picker (M1.2, WordPress' «Velg eller last opp medier»): the library with images only, where a click chooses a file
// and a new upload is chosen as it arrives. «Velg» hands the file to the block; the block stores only its id.
const props = defineProps<{ current?: string }>()
const emit = defineEmits<{ close: [item: MediaItem | undefined] }>()

const chosen = ref<MediaItem>()
const chosenId = computed(() => chosen.value?.id ?? props.current)
</script>

<template>
  <UModal
    :title="$t('media.picker.title')"
    fullscreen
    :ui="{ footer: 'justify-end' }"
    @update:open="emit('close', undefined)"
  >
    <template #body>
      <MediaLibrary picker group="image" :chosen="chosenId" @pick="chosen = $event" />
    </template>
    <template #footer>
      <p v-if="chosen" class="me-auto min-w-0 truncate text-sm text-toned" role="status">
        {{ $t('media.picker.chosen', { name: chosen.title || chosen.fileName }) }}
      </p>
      <UButton color="neutral" variant="outline" size="lg" class="min-h-11" @click="emit('close', undefined)">
        {{ $t('content.quickEdit.cancel') }}
      </UButton>
      <UButton size="lg" class="min-h-11" :disabled="!chosen" @click="emit('close', chosen)">
        {{ $t('media.picker.choose') }}
      </UButton>
    </template>
  </UModal>
</template>
