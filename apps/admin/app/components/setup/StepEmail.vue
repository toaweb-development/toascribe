<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { EmailTestError, SetupEmail, SetupEmailSaved } from '@toascribe/shared'

// Step 4: e-mail. The site sends mail (new passwords, notices), so the wizard saves the SMTP settings and sends a test mail:
// the step is done when that mail went out, or when the person chooses to skip it and knows a notice will say so later. The
// password is write-only: it is never shown again, only that one is saved.
const props = defineProps<{
  token: string
  /** What the api has saved of this step, if anything (a reload, or a step back). The password is never in it. */
  saved: SetupEmailSaved | null
  /** The step was skipped earlier. */
  skipped: boolean
  /** The site's e-mail address from the step before: where the test mail goes unless it is changed. */
  adminEmail: string
}>()

const emit = defineEmits<{ done: []; skipped: []; installed: []; lost: [message: string]; back: [] }>()

const { t } = useI18n()
const setupApi = useSetupApi()
const { pending, error, failures, run } = useSetupRequest((lost) => {
  if (lost.kind === 'installed') {
    emit('installed')
  } else {
    emit('lost', lost.message)
  }
})

type Secure = SetupEmail['secure']
const DEFAULT_PORT: Record<Secure, number> = { tls: 465, starttls: 587, none: 25 }

const encryptions = [
  { value: 'starttls', label: t('setup.email.encryption.starttls') },
  { value: 'tls', label: t('setup.email.encryption.tls') },
  { value: 'none', label: t('setup.email.encryption.none') },
]

const state = reactive({
  host: props.saved?.host ?? '',
  port: props.saved === null ? '' : String(props.saved.port),
  secure: (props.saved?.secure ?? 'starttls') as Secure,
  username: props.saved?.username ?? '',
  password: '',
  fromAddress: props.saved?.fromAddress ?? '',
  fromName: props.saved?.fromName ?? '',
  to: props.adminEmail,
})
const passwordVisible = ref(false)
const passwordSaved = computed(() => props.saved?.smtpPasswordSet === true)

/** Everything the test depends on. A change after a successful test means the test no longer says anything. */
function snapshot(): string {
  return JSON.stringify([
    state.host,
    state.port,
    state.secure,
    state.username,
    state.password,
    state.fromAddress,
    state.fromName,
  ])
}
const testedWith = ref<string>()
const tested = computed(() => testedWith.value !== undefined && testedWith.value === snapshot())
const testedTo = ref('')

const testFailure = ref<string>()

const { validateOn, failed } = useSubmitValidation()

function validate(current: Partial<typeof state>) {
  return [...validateSetupEmail(current, t), ...validateSetupTestRecipient(current, t)]
}

async function onInvalid(event: Parameters<typeof focusFirstError>[0]) {
  failed()
  await focusFirstError(event)
}

function testFailureText(code: EmailTestError): string {
  switch (code) {
    case 'send_failed':
      return t('setup.email.test.failed.sendFailed')
    case 'mail_config':
      return t('setup.email.test.failed.mailConfig')
    case 'timeout':
      return t('setup.email.test.failed.timeout')
    case 'queue_unavailable':
      return t('setup.email.test.failed.queueUnavailable')
    case 'busy':
      return t('setup.email.test.failed.busy')
  }
}

// Saves what is in the form, then sends the test mail. The password goes along only when one was typed: left empty, the api
// keeps the one it has.
async function onSubmit(event: FormSubmitEvent<typeof state>) {
  testFailure.value = undefined
  const data = event.data
  const email: SetupEmail = {
    host: data.host.trim(),
    secure: data.secure,
    fromAddress: data.fromAddress.trim(),
    username: data.username.trim(),
    ...(data.port.trim() === '' ? {} : { port: Number(data.port.trim()) }),
    ...(data.password === '' ? {} : { password: data.password }),
    ...(data.fromName.trim() === '' ? {} : { fromName: data.fromName.trim() }),
  }
  const to = data.to.trim()
  const sent = await run(async () => {
    await setupApi.saveEmail(props.token, email)
    return setupApi.testEmail(props.token, to)
  })
  if (sent === undefined) {
    return
  }
  if (sent.ok) {
    testedWith.value = snapshot()
    testedTo.value = to
  } else {
    testedWith.value = undefined
    testFailure.value = testFailureText(sent.error)
    failures.value += 1
  }
}

function next() {
  if (tested.value) {
    emit('done')
  }
}

async function skip() {
  const answer = await run(() => setupApi.skipEmail(props.token))
  if (answer !== undefined) {
    emit('skipped')
  }
}

const announcement = computed(() =>
  pending.value
    ? t('setup.email.test.sending')
    : tested.value
      ? t('setup.email.test.sent', { to: testedTo.value })
      : '',
)
</script>

<template>
  <div class="flex flex-col gap-6">
    <p class="text-base text-default">{{ $t('setup.email.intro') }}</p>
    <AuthMessage v-if="skipped" kind="info">{{ $t('setup.email.skippedBefore') }}</AuthMessage>
    <AuthMessage v-if="error" :key="failures" kind="error" focus>{{ error }}</AuthMessage>
    <AuthMessage v-else-if="testFailure" :key="failures" kind="error" focus>{{ testFailure }}</AuthMessage>

    <UForm
      :state="state"
      :validate="validate"
      novalidate
      :validate-on="validateOn"
      class="flex flex-col gap-6"
      @submit="onSubmit"
      @error="onInvalid"
    >
      <UFormField eager-validation name="host" :label="$t('setup.email.host')" :help="$t('setup.email.hostHelp')">
        <UInput
          v-model="state.host"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          size="xl"
          fixed
          class="w-full"
        />
      </UFormField>

      <UFormField name="secure" :label="$t('setup.email.encryption.label')">
        <USelect v-model="state.secure" :items="encryptions" value-key="value" size="xl" fixed class="w-full" />
      </UFormField>

      <UFormField
        eager-validation
        name="port"
        :label="$t('setup.email.port')"
        :help="$t('setup.email.portHelp', { port: DEFAULT_PORT[state.secure] })"
      >
        <UInput v-model="state.port" inputmode="numeric" autocomplete="off" size="xl" fixed class="w-full" />
      </UFormField>

      <UFormField
        eager-validation
        name="username"
        :label="$t('setup.email.username')"
        :help="$t('setup.email.usernameHelp')"
      >
        <UInput
          v-model="state.username"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          size="xl"
          fixed
          class="w-full"
        />
      </UFormField>

      <UFormField
        name="password"
        :label="$t('setup.email.password')"
        :hint="passwordSaved ? $t('setup.email.passwordSaved') : undefined"
        :help="passwordSaved ? $t('setup.email.passwordKeep') : $t('setup.email.passwordHelp')"
      >
        <AuthPasswordInput v-model="state.password" v-model:visible="passwordVisible" autocomplete="new-password" />
      </UFormField>

      <UFormField
        eager-validation
        name="fromAddress"
        :label="$t('setup.email.fromAddress')"
        :help="$t('setup.email.fromAddressHelp')"
      >
        <UInput
          v-model="state.fromAddress"
          type="email"
          autocomplete="off"
          inputmode="email"
          autocapitalize="none"
          spellcheck="false"
          size="xl"
          fixed
          class="w-full"
        />
      </UFormField>

      <UFormField
        eager-validation
        name="fromName"
        :label="$t('setup.email.fromName')"
        :help="$t('setup.email.fromNameHelp')"
      >
        <UInput v-model="state.fromName" autocomplete="off" size="xl" fixed class="w-full" />
      </UFormField>

      <fieldset class="flex flex-col gap-4 rounded-md border border-default p-4">
        <legend class="px-1 text-base font-semibold text-highlighted">{{ $t('setup.email.test.legend') }}</legend>
        <UFormField eager-validation name="to" :label="$t('setup.email.test.to')" :help="$t('setup.email.test.toHelp')">
          <UInput
            v-model="state.to"
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
        <div class="flex flex-col items-start gap-2">
          <UButton type="submit" color="neutral" variant="outline" size="xl" class="min-h-11" :loading="pending">{{
            $t('setup.email.test.submit')
          }}</UButton>
          <p role="status" class="text-base text-default">{{ announcement }}</p>
        </div>
      </fieldset>

      <p v-if="!tested" id="email-blocked" class="text-base text-default">{{ $t('setup.email.mustTest') }}</p>

      <div class="flex flex-wrap gap-2">
        <UButton color="neutral" variant="outline" size="xl" class="min-h-11" @click="emit('back')">{{
          $t('setup.nav.back')
        }}</UButton>
        <UButton
          size="xl"
          class="min-h-11"
          :aria-disabled="!tested"
          :aria-describedby="tested ? undefined : 'email-blocked'"
          @click="next"
          >{{ $t('setup.nav.next') }}</UButton
        >
      </div>
    </UForm>

    <section class="flex flex-col gap-3 border-t border-default pt-6" aria-labelledby="email-skip-title">
      <h3 id="email-skip-title" class="text-base font-semibold text-highlighted">
        {{ $t('setup.email.skip.heading') }}
      </h3>
      <AuthMessage kind="info">{{ $t('setup.email.skip.warning') }}</AuthMessage>
      <div>
        <UButton color="neutral" variant="outline" size="xl" class="min-h-11" :loading="pending" @click="skip">{{
          $t('setup.email.skip.button')
        }}</UButton>
      </div>
    </section>
  </div>
</template>
