<script setup lang="ts">
// «Rediger»: one post in the editor (WordPress' post.php?action=edit).
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t } = useI18n()
const route = useRoute()
useSeoMeta({ title: () => t('content.posts.edit') })
const id = computed(() => String(route.params.id))
</script>

<template>
  <ContentEditor :id="id" :key="id" type="post" />
</template>
