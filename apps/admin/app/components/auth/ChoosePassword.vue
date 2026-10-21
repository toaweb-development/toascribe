<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { generatePassword } from '@toascribe/shared'

// «Nytt passord» for the two links in a mail: `reset` (Mistet passordet?) and `set` (the welcome link of a new or registered
// account). The token is in the address fragment; it is read once and taken out of the address bar at once, and it only
// lives in this component until the form is sent. Both calls give back 204 and no session: the person logs in afterwards.
const props = defineProps<{
  mode: 'reset' | 'set'
}>()

const emit = defineEmits<{ done: [] }>()

const { t } = useI18n()
const authApi = useAuthApi()

// Unknown until the page is in the browser: a fragment is not sent to the server, so the server cannot see the token.
const token = ref<string>()
const checked = ref(false)

const state = reactive({ password: '' })
const { validateOn, failed } = useSubmitValidation()
const visible = ref(false)
const submitting = ref(false)
const error = ref<string>()
const failures = ref(0)
const generated = ref(false)

onMounted(() => {
  token.value = takeTokenFromAddress(window)
  checked.value = true
})

function validate(current: Partial<typeof state>) {
  return validateNewPassword(current, t)
}

function generate() {
  state.password = generatePassword()
  visible.value = true // shown, so it can be copied before it is saved
  generated.value = true
}

async function onInvalid(event: Parameters<typeof focusFirstError>[0]) {
  failed()
  await focusFirstError(event)
}

async function onSubmit(event: FormSubmitEvent<{ password: string }>) {
  if (token.value === undefined) {
    return
  }
  submitting.value = true
  error.value = undefined
  try {
    const send = props.mode === 'reset' ? authApi.resetPassword : authApi.setPassword
    await send(token.value, event.data.password)
    emit('done')
  } catch (caught) {
    if (caught instanceof ApiRequestError && caught.code === 'invalid_token') {
      token.value = undefined // used up or expired: the form cannot succeed, say so and offer a new link
    }
    error.value = describeApiError(caught, t)
    failures.value += 1
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div v-if="checked && token === undefined" class="flex flex-col gap-6">
    <AuthMessage kind="error" focus>{{ error ?? $t('error.invalidToken') }}</AuthMessage>
    <UButton :to="{ path: '/login', query: { action: 'lostpassword' } }" size="xl" block class="min-h-11">
      {{ $t('auth.choose.newLink') }}
    </UButton>
  </div>

  <div v-else class="flex flex-col gap-6">
    <p class="text-base text-default">
      {{ mode === 'reset' ? $t('auth.choose.introReset') : $t('auth.choose.introSet') }}
    </p>
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
      <UFormField eager-validation name="password" :label="$t('auth.choose.password')" :help="$t('auth.choose.help')">
        <AuthPasswordInput v-model="state.password" v-model:visible="visible" autocomplete="new-password" />
      </UFormField>

      <div class="flex flex-col gap-2">
        <AuthStrengthMeter :password="state.password" />
        <UButton color="neutral" variant="outline" size="lg" class="min-h-11 self-start" @click="generate">
          {{ $t('auth.choose.generate') }}
        </UButton>
        <p v-if="generated" role="status" class="text-sm text-toned">{{ $t('auth.choose.generated') }}</p>
      </div>

      <UButton type="submit" size="xl" block class="min-h-11" :loading="submitting">
        {{ $t('auth.choose.submit') }}
      </UButton>
    </UForm>
  </div>
</template>
