<script setup lang="ts">
// The link to the new address of an e-mail change (K-012): `?action=confirmemail#token=...`. It needs the session of the account
// that asked for the change, so a visitor without one is sent to log in first and comes back here; the token stays in the
// fragment of the address for that trip (a fragment is never sent to a server, so it is not in any log).
const emit = defineEmits<{ needsLogin: [] }>()

const { t } = useI18n()
const authApi = useAuthApi()
const auth = useAuth()

type Step = 'working' | 'done' | 'failed'
const step = ref<Step>('working')
const email = ref<string>()
const error = ref<string>()

onMounted(async () => {
  const token = tokenFromHash(window.location.hash)
  if (token === undefined) {
    takeTokenFromAddress(window)
    error.value = t('error.invalidToken')
    step.value = 'failed'
    return
  }
  const session = await auth.ensure().catch(() => undefined)
  if (session?.status !== 'authenticated') {
    emit('needsLogin') // the page sends them on; the fragment is left in the address
    return
  }
  takeTokenFromAddress(window)
  try {
    const answer = await authApi.confirmEmail(token)
    email.value = answer.email
    step.value = 'done'
  } catch (caught) {
    error.value = describeApiError(caught, t)
    step.value = 'failed'
  }
})
</script>

<template>
  <div v-if="step === 'working'" role="status" class="text-base text-default">{{ $t('auth.confirm.working') }}</div>

  <div v-else-if="step === 'done'" class="flex flex-col gap-6">
    <AuthMessage kind="success" focus>{{ $t('auth.confirm.done', { email }) }}</AuthMessage>
    <UButton to="/" size="xl" block class="min-h-11">{{ $t('auth.confirm.continue') }}</UButton>
  </div>

  <div v-else class="flex flex-col gap-6">
    <AuthMessage kind="error" focus>{{ error }}</AuthMessage>
    <UButton to="/" size="xl" block class="min-h-11">{{ $t('auth.confirm.continue') }}</UButton>
  </div>
</template>
