<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { LoginResponse } from '@toascribe/shared'

// «Brukernavn eller e-postadresse», «Passord» with the show/hide button, «Husk meg», «Logg inn» (wp-login.php, K-014).
// A wrong password and an unknown account give the same message (K-004). A name that has to wait (too many wrong tries) gets
// the wait from `Retry-After` instead, which is the same for a known and an unknown name.
const props = defineProps<{
  /** The target from the address, if there is one. The API checks it again and answers with the safe one. */
  redirectTo?: string
}>()

const emit = defineEmits<{ submitted: [answer: LoginResponse] }>()

const { t } = useI18n()
const auth = useAuth()

const state = reactive({ login: '', password: '', remember: false })
const { validateOn, failed } = useSubmitValidation()
const visible = ref(false)
const submitting = ref(false)
const error = ref<string>()
const failures = ref(0)

function validate(current: Partial<typeof state>) {
  return validateLogin(current, t)
}

async function onInvalid(event: Parameters<typeof focusFirstError>[0]) {
  failed()
  await focusFirstError(event)
}

async function onSubmit(event: FormSubmitEvent<typeof state>) {
  submitting.value = true
  error.value = undefined
  try {
    const answer = await auth.login({
      login: event.data.login.trim(),
      password: event.data.password,
      remember: event.data.remember,
      redirectTo: props.redirectTo,
    })
    emit('submitted', answer)
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
      <UFormField eager-validation name="password" :label="$t('auth.login.password')">
        <AuthPasswordInput v-model="state.password" v-model:visible="visible" autocomplete="current-password" />
      </UFormField>
      <UCheckbox v-model="state.remember" size="lg" :label="$t('auth.login.remember')" />
      <UButton type="submit" size="xl" block class="min-h-11" :loading="submitting">{{
        $t('auth.login.submit')
      }}</UButton>
    </UForm>
  </div>
</template>
