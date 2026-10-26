<script setup lang="ts">
// «Innlegg → Kategorier» (WordPress' edit-tags.php?taxonomy=category).
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t } = useI18n()
useSeoMeta({ title: () => t('terms.categories.title') })
</script>

<template>
  <TermsScreen taxonomy="category" />
</template>
