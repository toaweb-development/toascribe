<script setup lang="ts">
// «Alle innlegg» (WordPress' edit.php).
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t } = useI18n()
useSeoMeta({ title: () => t('content.posts.title') })
</script>

<template>
  <ContentListScreen type="post" />
</template>
