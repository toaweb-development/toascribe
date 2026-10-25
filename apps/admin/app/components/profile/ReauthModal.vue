<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'

import type { ReauthOutcome } from '~/composables/useReauth'

// The question the API asks before it changes something that is the owner's alone: the current password. There is no «recently signed
// in» window to rely on (services/reauth.ts is a password check on each call), so every such action sends the password in its own body
// and the dialog runs that action itself: a wrong password is answered under the field and the dialog stays, so the person can try
// again without losing what they were doing. Opened by `useReauth().ask()`.
const props = defineProps<{
  title: string
  /** One short sentence: what is about to happen, and (for a removal) what it costs. */
  description: string
  confirmLabel: string
  /** `error` for a removal. The destructive button is never the one that has focus on opening: the password field is. */
  color?: 'primary' | 'error'
  /** Runs with the password the person typed. Throws the ApiRequestError of a refusal. */
  action: (password: string) => Promise<unknown>
}>()

const emit = defineEmits<{ close: [outcome: ReauthOutcome] }>()

const { t } = useI18n()
const state = reactive({ password: '' })
const visible = ref(false)
const submitting = ref(false)
const fieldError = ref<string>()
const failure = ref<string>()
const { validateOn, failed } = useSubmitValidation()

// These answers can be tried again from the same dialog; any other refusal belongs to the page the action came from.
const RETRYABLE = new Set(['invalid_password', 'password_required', 'too_many_requests', 'network', 'timeout'])

function validate(current: Partial<typeof state>) {
  return (current.password ?? '') === '' ? [{ name: 'password', message: t('profile.reauth.passwordRequired') }] : []
}

async function onInvalid(event: Parameters<typeof focusFirstError>[0]) {
  failed()
  await focusFirstError(event)
}

async function onSubmit(event: FormSubmitEvent<typeof state>) {
  submitting.value = true
  fieldError.value = undefined
  failure.value = undefined
  try {
    await props.action(event.data.password)
    emit('close', { status: 'done' })
  } catch (caught) {
    if (caught instanceof ApiRequestError && !RETRYABLE.has(caught.code)) {
      emit('close', { status: 'failed', error: caught })
      return
    }
    if (
      caught instanceof ApiRequestError &&
      (caught.code === 'invalid_password' || caught.code === 'password_required')
    ) {
      fieldError.value = describeApiError(caught, t)
      state.password = ''
      focusSoon(() => document.querySelector<HTMLInputElement>('[data-reauth-password] input'))
    } else {
      failure.value = describeApiError(caught, t)
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal :title="title" :description="description" :dismissible="false" :close="false" :ui="{ footer: 'justify-end' }">
    <template #body>
      <UForm
        id="reauth-form"
        :state="state"
        :validate="validate"
        novalidate
        :validate-on="validateOn"
        class="flex flex-col gap-4"
        @submit="onSubmit"
        @error="onInvalid"
      >
        <p v-if="failure" role="alert" class="font-medium text-error">{{ failure }}</p>
        <UFormField
          eager-validation
          name="password"
          :label="$t('profile.reauth.password')"
          :help="$t('profile.reauth.help')"
          :error="fieldError"
          data-reauth-password
        >
          <AuthPasswordInput v-model="state.password" v-model:visible="visible" autocomplete="current-password" />
        </UFormField>
      </UForm>
    </template>

    <template #footer>
      <UButton
        color="neutral"
        variant="outline"
        size="lg"
        class="min-h-11"
        :disabled="submitting"
        @click="emit('close', { status: 'cancelled' })"
      >
        {{ $t('profile.reauth.cancel') }}
      </UButton>
      <UButton
        type="submit"
        form="reauth-form"
        size="lg"
        class="min-h-11"
        :color="color ?? 'primary'"
        :loading="submitting"
      >
        {{ confirmLabel }}
      </UButton>
    </template>
  </UModal>
</template>
