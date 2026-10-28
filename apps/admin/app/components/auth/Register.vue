<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { AuthOptionsResponse } from '@toascribe/shared'

// «Registrer»: a username and an e-mail address. The API answers the same whatever happened (the name may be taken, the
// address may have an account), so the confirmation says what could have happened and never what did.
const emit = defineEmits<{ sent: [] }>()

const { t } = useI18n()
const authApi = useAuthApi()

const state = reactive({ username: '', email: '' })
// Spam protection (K-006): the token that came with the page's options, and a field a person never sees.
const { data: options } = useNuxtData<AuthOptionsResponse | null>('auth:options')
const trap = ref('')
const { validateOn, failed } = useSubmitValidation()
const submitting = ref(false)
const error = ref<string>()
const failures = ref(0)

function validate(current: Partial<typeof state>) {
  return validateRegister(current, t)
}

async function onInvalid(event: Parameters<typeof focusFirstError>[0]) {
  failed()
  await focusFirstError(event)
}

async function onSubmit(event: FormSubmitEvent<typeof state>) {
  submitting.value = true
  error.value = undefined
  try {
    await authApi.register(event.data.username.trim(), event.data.email.trim(), options.value?.formToken ?? '', trap.value)
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
    <p class="text-base text-default">{{ $t('auth.register.intro') }}</p>
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
        name="username"
        :label="$t('auth.register.username')"
        :help="$t('auth.register.usernameHelp')"
      >
        <UInput
          v-model="state.username"
          autocomplete="username"
          autocapitalize="none"
          spellcheck="false"
          size="xl"
          fixed
          class="w-full"
        />
      </UFormField>
      <!-- K-006: out of sight and out of the tab order; a person leaves it empty, a bot that fills every field does not. -->
      <div class="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden="true">
        <label for="register-website">{{ $t('auth.register.trap') }}</label>
        <input id="register-website" v-model="trap" name="website" type="text" tabindex="-1" autocomplete="off" />
      </div>
      <UFormField eager-validation name="email" :label="$t('auth.register.email')">
        <UInput
          v-model="state.email"
          type="email"
          autocomplete="email"
          inputmode="email"
          autocapitalize="none"
          spellcheck="false"
          size="xl"
          fixed
          class="w-full"
        />
      </UFormField>
      <UButton type="submit" size="xl" block class="min-h-11" :loading="submitting">{{
        $t('auth.register.submit')
      }}</UButton>
    </UForm>
  </div>
</template>
