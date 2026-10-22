<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'

// The second step of a login for an account with an authenticator app: the six-digit code, or one recovery code.
// The redirect target is kept by the page (it is in the address); this component only says when the step is done.
const emit = defineEmits<{ verified: []; expired: [message: string] }>()

/** Show a warning from this many recovery codes left or fewer. */
const LOW_RECOVERY_CODES = 3

// True from the moment the code is sent until the page has left. The session is complete as soon as the API says so, and the
// page would otherwise swap this step for the login form before the person has seen the warning below.
const holding = defineModel<boolean>('holding', { default: false })

const { t } = useI18n()
const auth = useAuth()

const useRecovery = ref(false)
const submitting = ref(false)
const error = ref<string>()
const failures = ref(0)
const remaining = ref<number>()

const state = reactive({ code: '' })
const { validateOn, failed } = useSubmitValidation()

function validate(current: Partial<typeof state>) {
  return useRecovery.value ? validateRecoveryCode(current, t) : validateTotpCode(current, t)
}

function toggle() {
  useRecovery.value = !useRecovery.value
  state.code = ''
  // The field changed its label and its keyboard: put the cursor in it.
  void nextTick(() => document.querySelector<HTMLElement>('input[name="code"]')?.focus())
  error.value = undefined
}

async function onInvalid(event: Parameters<typeof focusFirstError>[0]) {
  failed()
  await focusFirstError(event)
}

async function onSubmit(event: FormSubmitEvent<typeof state>) {
  submitting.value = true
  holding.value = true
  error.value = undefined
  try {
    const code = cleanCode(event.data.code)
    const answer = await auth.verifyMfa(useRecovery.value ? { type: 'recovery', code } : { type: 'totp', code })
    const left = answer.recoveryCodesRemaining
    if (left !== null && left <= LOW_RECOVERY_CODES) {
      remaining.value = left // the warning is shown first; «Fortsett» leaves
    } else {
      emit('verified')
    }
  } catch (caught) {
    holding.value = false
    if (caught instanceof ApiRequestError && caught.status === 401) {
      // The half-open session lives ten minutes. It is gone: back to the password.
      auth.forget()
      emit('expired', describeApiError(caught, t))
    } else {
      error.value = describeApiError(caught, t)
      failures.value += 1
    }
  } finally {
    submitting.value = false
  }
}

function proceed() {
  emit('verified')
}
</script>

<template>
  <div v-if="remaining !== undefined" class="flex flex-col gap-6">
    <AuthMessage kind="info" focus>{{ $t('auth.mfa.lowCodes', remaining) }}</AuthMessage>
    <UButton size="xl" block class="min-h-11" @click="proceed">{{ $t('auth.mfa.continue') }}</UButton>
  </div>

  <div v-else class="flex flex-col gap-6">
    <p class="text-base text-default">{{ useRecovery ? $t('auth.mfa.recoveryIntro') : $t('auth.mfa.intro') }}</p>
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
      <UFormField
        eager-validation
        name="code"
        :label="useRecovery ? $t('auth.mfa.recoveryCode') : $t('auth.mfa.code')"
        :help="useRecovery ? $t('auth.mfa.recoveryCodeHelp') : $t('auth.mfa.codeHelp')"
      >
        <UInput
          :key="useRecovery ? 'recovery' : 'totp'"
          v-model="state.code"
          :autocomplete="useRecovery ? 'off' : 'one-time-code'"
          :inputmode="useRecovery ? 'text' : 'numeric'"
          :autocapitalize="useRecovery ? 'characters' : 'none'"
          spellcheck="false"
          size="xl"
          fixed
          class="w-full"
        />
      </UFormField>
      <UButton type="submit" size="xl" block class="min-h-11" :loading="submitting">{{
        $t('auth.mfa.submit')
      }}</UButton>
    </UForm>
    <UButton variant="link" color="neutral" size="lg" class="min-h-11 self-start px-0" @click="toggle">
      {{ useRecovery ? $t('auth.mfa.useApp') : $t('auth.mfa.useRecovery') }}
    </UButton>
  </div>
</template>
