<script setup lang="ts">
// A message above a form: an error (announced at once, and focus moves to it so the person lands on it), or a notice.
const props = defineProps<{
  kind: 'error' | 'info' | 'success'
  /** Move focus here when the message appears. For errors after a submit; not for a notice that is there on arrival. */
  focus?: boolean
}>()

const root = useTemplateRef<HTMLElement>('root')

onMounted(() => {
  if (props.focus === true) {
    root.value?.focus()
  }
})

const color = computed(() => (props.kind === 'error' ? 'error' : props.kind === 'success' ? 'success' : 'info'))
</script>

<template>
  <div
    ref="root"
    :role="kind === 'error' ? 'alert' : 'status'"
    tabindex="-1"
    class="outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md"
  >
    <UAlert :color="color" variant="subtle">
      <template #description>
        <slot />
      </template>
    </UAlert>
  </div>
</template>
