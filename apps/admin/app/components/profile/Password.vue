<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'

// «Nytt passord» (WordPress' «Sett nytt passord»): the button reveals a password that is already made, with the strength meter, the
// show/hide button and «Avbryt». It is saved by its own button, not with «Oppdater profil»: changing the password needs the current
// one (a dialog asks), ends the other sessions, and is a security action of its own. The weak-password refusal of the API is
// shown on the field.
const { t } = useI18n()
const meApi = useMeApi()
const reauth = useReauth()

const open = ref(false)
const state = reactive({ password: '' })
const visible = ref(false)
const fields = useTemplateRef<{ generate: () => void }>('fields')
const formRef = useTemplateRef<{ setErrors: (errors: FieldError[]) => void }>('formRef')
const opener = useTemplateRef<{ $el: HTMLElement }>('opener')
const { validateOn, failed } = useSubmitValidation()
const done = ref('')
const failure = ref<string>()

async function begin() {
  done.value = ''
  failure.value = undefined
  open.value = true
  await nextTick()
  fields.value?.generate() // WordPress makes a strong password for you; it is shown so it can be copied
  await nextTick()
  document.querySelector<HTMLElement>('#new-password-form [name="password"]')?.focus()
}

async function close() {
  open.value = false
  state.password = ''
  visible.value = false
  failure.value = undefined
  await nextTick()
  opener.value?.$el.focus()
}

function validate(current: Partial<typeof state>) {
  return validateNewPassword(current, t)
}

async function onInvalid(event: Parameters<typeof focusFirstError>[0]) {
  failed()
  await focusFirstError(event)
}

async function onSubmit(event: FormSubmitEvent<typeof state>) {
  failure.value = undefined
  const newPassword = event.data.password
  const outcome = await reauth.ask({
    title: t('profile.password.confirmTitle'),
    description: t('profile.password.confirmText'),
    confirmLabel: t('profile.password.confirmButton'),
    action: (current) => meApi.changePassword(current, newPassword),
  })
  if (outcome.status === 'done') {
    await close()
    done.value = t('profile.password.changed')
    await refreshNuxtData('profile:sessions') // the other sessions have ended
  } else if (outcome.status === 'failed') {
    if (outcome.error.code === 'weak_password') {
      formRef.value?.setErrors([{ name: 'password', message: describeApiError(outcome.error, t) }])
      focusSoon(() => document.querySelector<HTMLElement>('#new-password-form [name="password"]'))
    } else {
      failure.value = describeApiError(outcome.error, t)
    }
  }
}
</script>

<template>
  <ProfileSection id="password" :title="$t('profile.password.title')" :level="3">
    <div class="flex flex-col gap-4">
      <p class="text-base text-default">{{ $t('profile.password.intro') }}</p>

      <UButton
        v-if="!open"
        ref="opener"
        color="neutral"
        variant="outline"
        size="lg"
        class="min-h-11 self-start"
        @click="begin"
      >
        {{ $t('profile.password.set') }}
      </UButton>

      <UForm
        v-if="open"
        id="new-password-form"
        ref="formRef"
        :state="state"
        :validate="validate"
        novalidate
        :validate-on="validateOn"
        class="flex flex-col gap-4"
        @submit="onSubmit"
        @error="onInvalid"
      >
        <AuthNewPasswordFields
          ref="fields"
          v-model="state.password"
          v-model:visible="visible"
          :label="$t('profile.password.new')"
        />
        <div class="flex flex-wrap gap-2">
          <UButton type="submit" size="lg" class="min-h-11">{{ $t('profile.password.save') }}</UButton>
          <UButton color="neutral" variant="outline" size="lg" class="min-h-11" @click="close">
            {{ $t('profile.password.cancel') }}
          </UButton>
        </div>
      </UForm>

      <p v-if="failure" role="alert" class="font-medium text-error">{{ failure }}</p>
      <!-- The region stays in the page, empty, so the text put into it is announced. -->
      <div role="status" class="min-h-6 text-sm text-default">
        <span v-if="done" class="inline-flex items-start gap-1.5">
          <UIcon name="i-lucide-check" class="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          <span>{{ done }}</span>
        </span>
      </div>
    </div>
  </ProfileSection>
</template>
