<script setup lang="ts">
// «Alle sider» (WordPress' edit.php?post_type=page).
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t } = useI18n()
useSeoMeta({ title: () => t('content.pages.title') })
</script>

<template>
  <ContentListScreen type="page" />
</template>
