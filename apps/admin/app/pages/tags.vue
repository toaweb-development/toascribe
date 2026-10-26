<script setup lang="ts">
// «Innlegg → Stikkord» (WordPress' edit-tags.php?taxonomy=post_tag).
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t } = useI18n()
useSeoMeta({ title: () => t('terms.tags.title') })
</script>

<template>
  <TermsScreen taxonomy="post_tag" />
</template>
