<script setup lang="ts">
import type { ContentListItem } from '@toascribe/shared'

// The row actions under a title (WordPress' «Rediger | Hurtigredigering | Papirkurv | Forhåndsvis»; in the trash «Gjenopprett | Slett
// permanent»). Only the actions the account may take on this item are drawn (`can` from the api). Each names its item for a screen
// reader, because «Rediger» alone repeats down the list.
const props = defineProps<{
  item: ContentListItem
  inTrash: boolean
  editPath: string
  previewPath: string
  actionClass: string
  dangerClass: string
}>()

const emit = defineEmits<{ quickEdit: []; trash: []; restore: []; remove: [] }>()

const { t } = useI18n()
const named = computed(() => titleOf(t, props.item.title))
</script>

<template>
  <ul class="flex flex-wrap items-center gap-x-3 gap-y-0" :aria-label="$t('content.actions.label', { title: named })">
    <template v-if="!inTrash">
      <li v-if="item.can.edit">
        <NuxtLink :to="editPath" :class="actionClass" :aria-label="$t('content.actions.editNamed', { title: named })">
          {{ $t('content.actions.edit') }}
        </NuxtLink>
      </li>
      <li v-if="item.can.edit">
        <button
          type="button"
          :class="actionClass"
          :aria-label="$t('content.actions.quickEditNamed', { title: named })"
          @click="emit('quickEdit')"
        >
          {{ $t('content.actions.quickEdit') }}
        </button>
      </li>
      <li v-if="item.can.delete">
        <button
          type="button"
          :class="dangerClass"
          :aria-label="$t('content.actions.trashNamed', { title: named })"
          @click="emit('trash')"
        >
          {{ $t('content.actions.trash') }}
        </button>
      </li>
      <li>
        <NuxtLink
          :to="previewPath"
          external
          :class="actionClass"
          :aria-label="$t('content.actions.previewNamed', { title: named })"
        >
          {{ $t('content.actions.preview') }}
        </NuxtLink>
      </li>
    </template>
    <template v-else-if="item.can.delete">
      <li>
        <button
          type="button"
          :class="actionClass"
          :aria-label="$t('content.actions.restoreNamed', { title: named })"
          @click="emit('restore')"
        >
          {{ $t('content.actions.restore') }}
        </button>
      </li>
      <li>
        <button
          type="button"
          :class="dangerClass"
          :aria-label="$t('content.actions.removeNamed', { title: named })"
          @click="emit('remove')"
        >
          {{ $t('content.actions.remove') }}
        </button>
      </li>
    </template>
  </ul>
</template>
