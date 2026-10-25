<script setup lang="ts">
import { USERS_SEARCH_MAX_LENGTH } from '@toascribe/shared'

// «Søk i brukere». It searches when the form is sent (the button or Enter), as WordPress does, and not on every key: the list is a
// request to the API, and a screen reader would hear the result change under a person who is still typing. The field shows what the
// address says, so a reload or the back button brings the text back.
const props = defineProps<{ search: string }>()
const emit = defineEmits<{ submit: [search: string] }>()

const text = ref(props.search)
watch(
  () => props.search,
  (next) => {
    text.value = next
  },
)
</script>

<template>
  <form role="search" class="flex flex-wrap items-end gap-2" @submit.prevent="emit('submit', text.trim())">
    <div class="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-xs">
      <label for="users-search" class="font-medium text-default">{{ $t('users.search.label') }}</label>
      <UInput
        id="users-search"
        v-model="text"
        type="search"
        name="search"
        size="xl"
        fixed
        class="w-full"
        autocomplete="off"
        :maxlength="USERS_SEARCH_MAX_LENGTH"
        icon="i-lucide-search"
      />
    </div>
    <UButton type="submit" color="neutral" variant="outline" size="lg" class="min-h-11">
      {{ $t('users.search.button') }}
    </UButton>
  </form>
</template>
