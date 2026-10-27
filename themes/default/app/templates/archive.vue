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
</script>

<template>
  <ThemeListing :heading="heading" />
</template>
