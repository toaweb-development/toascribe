<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'

// Step 1: the setup code. The api wrote it to its log (as an address with `#token=`) when it started; opening that address
// skips this form, because the wizard has already read the code from it. Pasting is for the person who has only the code.
const props = defineProps<{
  /** The code is known and was accepted by the api. */
  accepted: boolean
  /** Why the code that came with the address (or was kept for this tab) was not accepted, if it was not. */
  notice?: string
}>()

const emit = defineEmits<{ accepted: [token: string]; installed: []; next: [] }>()

const { t } = useI18n()
const setupApi = useSetupApi()

// Commands are not translated text.
const LOG_COMMAND = 'docker compose logs api'
const RENEW_COMMAND = 'docker compose exec api toa core setup-token'

const state = reactive({ token: '' })
const { validateOn, failed } = useSubmitValidation()
const { pending, error, failures, run } = useSetupRequest((lost) => {
  if (lost.kind === 'installed') {
    emit('installed')
  } else {
    error.value = lost.message
    failures.value += 1
  }
})

function validate(current: Partial<typeof state>) {
  return validateSetupToken(current, t)
}

async function onInvalid(event: Parameters<typeof focusFirstError>[0]) {
  failed()
  await focusFirstError(event)
}

async function onSubmit(event: FormSubmitEvent<typeof state>) {
  const token = event.data.token.trim()
  const answer = await run(() => setupApi.verifyToken(token))
  if (answer !== undefined) {
    emit('accepted', token)
  }
}

const shownError = computed(() => error.value ?? props.notice)
</script>

<template>
  <div v-if="accepted" class="flex flex-col gap-6">
    <AuthMessage kind="success">{{ $t('setup.token.accepted') }}</AuthMessage>
    <div class="flex flex-wrap gap-2">
      <UButton size="xl" class="min-h-11" @click="emit('next')">{{ $t('setup.nav.next') }}</UButton>
    </div>
  </div>

  <div v-else class="flex flex-col gap-6">
    <i18n-t keypath="setup.token.hint" tag="p" class="text-base text-default">
      <template #logs>
        <code class="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-sm text-highlighted">{{ LOG_COMMAND }}</code>
      </template>
      <template #renew>
        <code class="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-sm text-highlighted">{{ RENEW_COMMAND }}</code>
      </template>
    </i18n-t>
    <AuthMessage v-if="shownError" :key="failures" kind="error" :focus="error !== undefined">{{
      shownError
    }}</AuthMessage>
    <UForm
      :state="state"
      :validate="validate"
      novalidate
      :validate-on="validateOn"
      class="flex flex-col gap-6"
      @submit="onSubmit"
      @error="onInvalid"
    >
      <UFormField eager-validation name="token" :label="$t('setup.token.label')" :help="$t('setup.token.help')">
        <UInput
          v-model="state.token"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          size="xl"
          fixed
          :ui="{ base: 'font-mono' }"
          class="w-full"
        />
      </UFormField>
      <div class="flex flex-wrap gap-2">
        <UButton type="submit" size="xl" class="min-h-11" :loading="pending">{{ $t('setup.token.submit') }}</UButton>
      </div>
    </UForm>
  </div>
</template>
