<script setup lang="ts">
import { generatePassword } from '@toascribe/shared'

// Step 5: the first administrator, and then the recovery key. The account is made by the install at the very end (in the same
// transaction as the default content), so nothing is sent for it here: the form is checked, the person goes on to the key,
// and the account waits in memory until «Fullfør». The password is never written anywhere in the browser.
export interface AdminDraft {
  username: string
  email: string
  password: string
}

const props = defineProps<{
  token: string
  /** What the person typed before, kept by the wizard while they move between steps. */
  draft: AdminDraft | null
  /** The site's e-mail address: offered as the administrator's. */
  defaultEmail: string
  siteTitle: string
  /** A message from the install that this step must fix (the name was taken, the key was not the last one). */
  problem?: string
}>()

const emit = defineEmits<{
  ready: [draft: AdminDraft, recoveryKey: string]
  installed: []
  lost: [message: string]
  back: []
}>()

const { t } = useI18n()
const setupApi = useSetupApi()
const { pending, error, failures, run } = useSetupRequest((lost) => {
  if (lost.kind === 'installed') {
    emit('installed')
  } else {
    emit('lost', lost.message)
  }
})

const state = reactive({
  username: props.draft?.username ?? '',
  email: props.draft?.email ?? props.defaultEmail,
  password: props.draft?.password ?? '',
})
const visible = ref(false)
const generated = ref(false)

// 'account': the form. 'key': the recovery key, once the form was accepted.
const stage = ref<'account' | 'key'>('account')
const recoveryKey = ref('')
const keySaved = ref(false)

const { validateOn, failed } = useSubmitValidation()

function validate(current: Partial<typeof state>) {
  return validateSetupAdmin(current, t)
}

async function onInvalid(event: Parameters<typeof focusFirstError>[0]) {
  failed()
  await focusFirstError(event)
}

function generate() {
  state.password = generatePassword()
  visible.value = true // shown, so it can be copied before it is saved
  generated.value = true
}

// A new key each time the person comes from the form: the api keeps the last one made, so an older key stops working.
async function onSubmit() {
  const answer = await run(() => setupApi.recoveryKey(props.token))
  if (answer === undefined) {
    return
  }
  recoveryKey.value = answer.recoveryKey
  keySaved.value = false
  stage.value = 'key'
}

const continueHint = computed(() => (keySaved.value ? undefined : 'key-blocked'))

function finish() {
  if (!keySaved.value) {
    return
  }
  emit(
    'ready',
    { username: state.username.trim(), email: state.email.trim(), password: state.password },
    recoveryKey.value,
  )
}

function backToForm() {
  stage.value = 'account'
}
</script>

<template>
  <div v-if="stage === 'account'" class="flex flex-col gap-6">
    <p class="text-base text-default">{{ $t('setup.admin.intro') }}</p>
    <AuthMessage v-if="problem" kind="error" focus>{{ problem }}</AuthMessage>
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
        :label="$t('setup.admin.username')"
        :help="$t('setup.admin.usernameHelp')"
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
      <UFormField eager-validation name="email" :label="$t('setup.admin.email')" :help="$t('setup.admin.emailHelp')">
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
      <UFormField eager-validation name="password" :label="$t('setup.admin.password')" :help="$t('auth.choose.help')">
        <AuthPasswordInput v-model="state.password" v-model:visible="visible" autocomplete="new-password" />
      </UFormField>

      <div class="flex flex-col gap-2">
        <AuthStrengthMeter :password="state.password" />
        <UButton color="neutral" variant="outline" size="lg" class="min-h-11 self-start" @click="generate">
          {{ $t('auth.choose.generate') }}
        </UButton>
        <p v-if="generated" role="status" class="text-sm text-toned">{{ $t('auth.choose.generated') }}</p>
      </div>

      <div class="flex flex-wrap gap-2">
        <UButton color="neutral" variant="outline" size="xl" class="min-h-11" @click="emit('back')">{{
          $t('setup.nav.back')
        }}</UButton>
        <UButton type="submit" size="xl" class="min-h-11" :loading="pending">{{ $t('setup.admin.toKey') }}</UButton>
      </div>
    </UForm>
  </div>

  <div v-else class="flex flex-col gap-6">
    <SetupRecoveryKey v-model:saved="keySaved" :recovery-key="recoveryKey" :site-title="siteTitle" />
    <p v-if="!keySaved" id="key-blocked" class="text-base text-default">{{ $t('setup.key.mustConfirm') }}</p>
    <div class="flex flex-wrap gap-2">
      <UButton color="neutral" variant="outline" size="xl" class="min-h-11" @click="backToForm">{{
        $t('setup.nav.back')
      }}</UButton>
      <UButton size="xl" class="min-h-11" :aria-disabled="!keySaved" :aria-describedby="continueHint" @click="finish">{{
        $t('setup.nav.next')
      }}</UButton>
    </div>
  </div>
</template>
