<script setup lang="ts">
// Category, tag, author and date archives: the archive's name over its posts.
const { t } = useI18n()
const { archive } = useContent()

const heading = computed(() => {
  const found = archive.value
  if (found?.type === 'category') return t('theme.archive.category', { name: found.term.name })
  if (found?.type === 'tag') return t('theme.archive.tag', { name: found.term.name })
  if (found?.type === 'author') return t('theme.archive.author', { name: found.author.displayName })
  if (found?.type === 'date') {
    return t('theme.archive.date', {
      date: [found.year, found.month, found.day].filter((part) => part !== null).join('-'),
    })
  }
  return undefined
})

// «Vis avatarer» (M1.8, K-236): the author's picture, or the initials when there is none. Not there when avatars are off.
const author = computed(() => {
  const found = archive.value
  return found?.type === 'author' && found.author.avatarUrl !== undefined ? found.author : undefined
})
</script>

<template>
  <div v-if="author" class="mx-auto mt-8 flex max-w-3xl justify-center px-4">
    <UAvatar :src="author.avatarUrl ?? undefined" :alt="author.displayName" size="3xl" />
  </div>
  <ThemeListing :heading="heading" />
</template>
