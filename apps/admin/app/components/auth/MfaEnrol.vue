<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { MfaEnrolStartResponse } from '@toascribe/shared'

// The role of the account requires a second factor and it has none: scan the QR code (or type the key), confirm with the
// first code, then keep the recovery codes. The QR code is an SVG document made by the API; it is shown as an image from a
// data address, never inserted as markup, so nothing in it can run.
const emit = defineEmits<{ finished: []; expired: [message: string] }>()

// True from the moment the code is sent until the page has left (see MfaVerify): the session is complete as soon as the first
// code is confirmed, and the recovery codes must still be shown.
const holding = defineModel<boolean>('holding', { default: false })

const { t } = useI18n()
const auth = useAuth()

type Step = 'starting' | 'scan' | 'codes' | 'failed'
const step = ref<Step>('starting')
const setup = ref<MfaEnrolStartResponse>()
const recoveryCodes = ref<readonly string[]>([])
const saved = ref(false)
const submitting = ref(false)
const error = ref<string>()
const failures = ref(0)

const qrSource = computed(() =>
  setup.value === undefined ? undefined : `data:image/svg+xml;utf8,${encodeURIComponent(setup.value.qrSvg)}`,
)

/** The key in groups of four, to read and type: `ABCD EFGH IJKL`. */
const groupedSecret = computed(() => (setup.value?.secret ?? '').replace(/(.{4})(?=.)/g, '$1 '))

const state = reactive({ code: '' })
const { validateOn, failed } = useSubmitValidation()

function validate(current: Partial<typeof state>) {
  return validateTotpCode(current, t)
}

async function start() {
  step.value = 'starting'
  error.value = undefined
  try {
    setup.value = await auth.enrolStart()
    step.value = 'scan'
  } catch (caught) {
    if (caught instanceof ApiRequestError && caught.status === 401) {
      auth.forget()
      emit('expired', describeApiError(caught, t))
      return
    }
    error.value = describeApiError(caught, t)
    step.value = 'failed'
  }
}

// The secret is made by a POST, so it is asked for in the browser and not while the page renders on the server.
onMounted(start)

async function onInvalid(event: Parameters<typeof focusFirstError>[0]) {
  failed()
  await focusFirstError(event)
}

async function onSubmit(event: FormSubmitEvent<typeof state>) {
  if (setup.value === undefined) {
    return
  }
  submitting.value = true
  holding.value = true
  error.value = undefined
  try {
    const answer = await auth.confirmEnrolment(setup.value.id, cleanCode(event.data.code))
    if (answer.recoveryCodes !== null && answer.recoveryCodes.length > 0) {
      recoveryCodes.value = answer.recoveryCodes
      step.value = 'codes'
    } else {
      emit('finished')
    }
  } catch (caught) {
    holding.value = false
    error.value = describeApiError(caught, t)
    failures.value += 1
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div v-if="step === 'starting'" role="status" class="text-base text-default">{{ $t('auth.enrol.starting') }}</div>

  <div v-else-if="step === 'failed'" class="flex flex-col gap-6">
    <AuthMessage kind="error" focus>{{ error }}</AuthMessage>
    <UButton size="xl" block class="min-h-11" @click="start">{{ $t('auth.enrol.retry') }}</UButton>
  </div>

  <div v-else-if="step === 'scan'" class="flex flex-col gap-6">
    <p class="text-base text-default">{{ $t('auth.enrol.intro') }}</p>
    <!-- Prettier writes a void element with a slash, which this rule forbids: the two disagree, so the rule is off for this tag. -->
    <!-- eslint-disable vue/html-self-closing -->
    <img
      v-if="qrSource"
      :src="qrSource"
      :alt="$t('auth.enrol.qrAlt')"
      width="192"
      height="192"
      class="mx-auto size-48 rounded-md bg-white p-2"
    />
    <!-- eslint-enable vue/html-self-closing -->
    <div>
      <p class="text-sm text-toned">{{ $t('auth.enrol.keyLabel') }}</p>
      <p class="font-mono text-base break-all text-highlighted select-all">{{ groupedSecret }}</p>
    </div>
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
      <UFormField eager-validation name="code" :label="$t('auth.mfa.code')" :help="$t('auth.enrol.codeHelp')">
        <UInput
          v-model="state.code"
          autocomplete="one-time-code"
          inputmode="numeric"
          spellcheck="false"
          size="xl"
          fixed
          class="w-full"
        />
      </UFormField>
      <UButton type="submit" size="xl" block class="min-h-11" :loading="submitting">{{
        $t('auth.enrol.submit')
      }}</UButton>
    </UForm>
  </div>

  <div v-else class="flex flex-col gap-6">
    <AuthRecoveryCodes v-model:saved="saved" :codes="recoveryCodes" />
    <UButton
      size="xl"
      block
      class="min-h-11 print:hidden"
      :class="{ 'opacity-60': !saved }"
      :aria-disabled="!saved"
      :aria-describedby="saved ? undefined : 'finish-hint'"
      @click="saved ? emit('finished') : undefined"
    >
      {{ $t('auth.enrol.finish') }}
    </UButton>
    <p v-if="!saved" id="finish-hint" class="text-sm text-toned print:hidden">{{ $t('auth.enrol.finishHint') }}</p>
  </div>
</template>
