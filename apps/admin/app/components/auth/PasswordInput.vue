<script setup lang="ts">
// A password field with the show/hide button (K-014). Used inside a UFormField, which gives the input its id and
// error text. The visibility is the parent's too (`generate` shows the new password so it can be copied).
const model = defineModel<string>({ default: '' })
const visible = defineModel<boolean>('visible', { default: false })

defineProps<{
  autocomplete: 'new-password' | 'current-password'
}>()

const input = useTemplateRef<{ inputRef?: HTMLInputElement | null }>('input')
const inputId = computed(() => input.value?.inputRef?.id)
</script>

<template>
  <UInput
    ref="input"
    v-model="model"
    :type="visible ? 'text' : 'password'"
    :autocomplete="autocomplete"
    size="xl"
    fixed
    class="w-full"
    spellcheck="false"
    autocapitalize="none"
  >
    <template #trailing>
      <UButton
        color="neutral"
        variant="link"
        size="sm"
        :icon="visible ? 'i-lucide-eye-off' : 'i-lucide-eye'"
        :aria-label="visible ? $t('auth.password.hide') : $t('auth.password.show')"
        :aria-pressed="visible"
        :aria-controls="inputId"
        class="min-h-11 min-w-11 justify-center"
        @click="visible = !visible"
      />
    </template>
  </UInput>
</template>
