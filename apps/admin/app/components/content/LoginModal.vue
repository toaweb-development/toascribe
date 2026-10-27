<script setup lang="ts">
import type { LoginResponse } from '@toascribe/shared'

// The session ran out while editing (K-010, WordPress' wp-auth-check): sign in again here, over the editor, so nothing that is not
// saved is lost. The same form and code step as the login screen; an account that has to set up its authenticator app first does
// that on the login screen, in a new tab, and comes back. The editor then saves what it was saving.
const emit = defineEmits<{ close: [signedIn: boolean] }>()

const { t } = useI18n()
const step = ref<'password' | 'verify' | 'enrol'>('password')
const expired = ref<string>()
const loginUrl = `${useRuntimeConfig().app.baseURL.replace(/\/$/, '')}/login`

function onSubmitted(answer: LoginResponse): void {
  if (answer.status === 'authenticated') {
    emit('close', true)
  } else {
    step.value = answer.mfa === 'enrolment' ? 'enrol' : 'verify'
  }
}
</script>

<template>
  <UModal
    :title="t('editor.login.title')"
    :description="t('editor.login.description')"
    :dismissible="false"
    :close="false"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <UAlert v-if="expired" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="expired" />
        <AuthLoginForm v-if="step === 'password'" @submitted="onSubmitted" />
        <AuthMfaVerify
          v-else-if="step === 'verify'"
          @verified="emit('close', true)"
          @expired="
            (message) => {
              expired = message
              step = 'password'
            }
          "
        />
        <template v-else>
          <p class="text-sm text-default">{{ t('editor.login.enrol') }}</p>
          <UButton
            :to="loginUrl"
            target="_blank"
            external
            class="min-h-11 self-start"
            :label="t('editor.login.openLogin')"
          />
        </template>
      </div>
    </template>
    <template #footer>
      <UButton
        color="neutral"
        variant="ghost"
        class="min-h-11"
        :label="t('editor.login.later')"
        @click="emit('close', false)"
      />
    </template>
  </UModal>
</template>
