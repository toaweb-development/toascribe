<script setup lang="ts">
// «Legg til nytt»: a new post, made on the first save (WordPress' post-new.php).
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t } = useI18n()
useSeoMeta({ title: () => t('content.posts.addTitle') })
</script>

<template>
  <ContentEditor type="post" />
</template>
