<script setup lang="ts">
// Step 6: the default content. Nothing to fill in; the page says what the install will make, in the words of WordPress.
const props = defineProps<{
  /** The language chosen for the site: it decides the language of the content. */
  locale: string
}>()

const emit = defineEmits<{ next: []; back: [] }>()

const names = computed(() => defaultContentNames(props.locale))
</script>

<template>
  <div class="flex flex-col gap-6">
    <p class="text-base text-default">{{ $t('setup.content.intro') }}</p>
    <ul class="flex list-disc flex-col gap-2 pl-6 text-base text-default">
      <li>{{ $t('setup.content.post', { title: names.post }) }}</li>
      <li>{{ $t('setup.content.page', { title: names.page }) }}</li>
      <li>{{ $t('setup.content.privacy', { title: names.privacyPage }) }}</li>
      <li>{{ $t('setup.content.category', { title: names.category }) }}</li>
    </ul>
    <p class="text-base text-default">{{ $t('setup.content.outro') }}</p>
    <div class="flex flex-wrap gap-2">
      <UButton color="neutral" variant="outline" size="xl" class="min-h-11" @click="emit('back')">{{
        $t('setup.nav.back')
      }}</UButton>
      <UButton size="xl" class="min-h-11" @click="emit('next')">{{ $t('setup.nav.next') }}</UButton>
    </div>
  </div>
</template>
