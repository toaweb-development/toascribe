<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'

// «Mistet passordet?»: one field, and the same answer whatever the API knew about it (K-004). The confirmation is shown on the
// login screen, like WordPress' `?checkemail=confirm`.
const emit = defineEmits<{ sent: [] }>()

const { t } = useI18n()
const authApi = useAuthApi()

const state = reactive({ login: '' })
const { validateOn, failed } = useSubmitValidation()
const submitting = ref(false)
const error = ref<string>()
const failures = ref(0)

function validate(current: Partial<typeof state>) {
  return validateLostPassword(current, t)
}

async function onInvalid(event: Parameters<typeof focusFirstError>[0]) {
  failed()
  await focusFirstError(event)
}

async function onSubmit(event: FormSubmitEvent<typeof state>) {
  submitting.value = true
  error.value = undefined
  try {
    await authApi.lostPassword(event.data.login.trim())
    emit('sent')
  } catch (caught) {
    error.value = describeApiError(caught, t)
    failures.value += 1
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <p class="text-base text-default">{{ $t('auth.lost.intro') }}</p>
    <AuthMessage v-if="error" :key="failures" kind="error" focus>{{ error }}</AuthMessage>
    <UForm
      :state="state"
      :validate="validate"
      novalidate
      :validate-on="validateOn"
      class="flex flex-col gap-6"
      @submit="onSubmit"
      @error="onInvalid"
    >
      <UFormField eager-validation name="login" :label="$t('auth.login.username')">
        <UInput
          v-model="state.login"
          autocomplete="username"
          autocapitalize="none"
          spellcheck="false"
          size="xl"
          fixed
          class="w-full"
        />
      </UFormField>
      <UButton type="submit" size="xl" block class="min-h-11" :loading="submitting">{{
        $t('auth.lost.submit')
      }}</UButton>
    </UForm>
  </div>
</template>
