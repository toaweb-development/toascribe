<script setup lang="ts">
// «Legg til ny»: a new page, made on the first save (WordPress' post-new.php?post_type=page).
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t } = useI18n()
useSeoMeta({ title: () => t('content.pages.addTitle') })
</script>

<template>
  <ContentEditor type="page" />
</template>
