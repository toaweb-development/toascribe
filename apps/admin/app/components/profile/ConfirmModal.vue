<script setup lang="ts">
// A confirmation that names the object and the consequence (content-design §8, workflows §17). «Avbryt» comes first in the tab order and
// gets the focus: the destructive button is never the default. Opened by `useConfirmDialog().ask()`; it answers true or false.
defineProps<{
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
  color?: 'primary' | 'error'
}>()

const emit = defineEmits<{ close: [confirmed: boolean] }>()
</script>

<template>
  <UModal :title="title" :description="description" :dismissible="false" :close="false" :ui="{ footer: 'justify-end' }">
    <template #footer>
      <UButton color="neutral" variant="outline" size="lg" class="min-h-11" @click="emit('close', false)">
        {{ cancelLabel }}
      </UButton>
      <UButton size="lg" class="min-h-11" :color="color ?? 'primary'" @click="emit('close', true)">
        {{ confirmLabel }}
      </UButton>
    </template>
  </UModal>
</template>
