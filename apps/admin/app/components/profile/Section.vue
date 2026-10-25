<script setup lang="ts">
// One section of the profile page: a card with a heading that names it (a section heading names its content, content-design §4).
// `level` is 2 for the sections of the page and 3 for the parts of «Kontoadministrasjon».
const props = withDefaults(
  defineProps<{
    id: string
    title: string
    level?: 2 | 3
  }>(),
  { level: 2 },
)

const headingId = computed(() => `${props.id}-heading`)
</script>

<template>
  <UCard :id="id" as="section" :aria-labelledby="headingId">
    <template #header>
      <component
        :is="`h${level}`"
        :id="headingId"
        tabindex="-1"
        class="text-lg font-semibold text-highlighted outline-none"
      >
        {{ title }}
      </component>
    </template>
    <slot />
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </UCard>
</template>
