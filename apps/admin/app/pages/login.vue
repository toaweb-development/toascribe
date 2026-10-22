<script setup lang="ts">
import type { LoginResponse } from '@toascribe/shared'

// One address, many screens, like wp-login.php: the `action` in the query picks the screen (utils/auth-actions.ts), and a
// logged-in-but-not-yet-verified session picks the second step of the login. The middleware has already sent a signed-in
// person on and turned `?action=register` and `?action=logout` into their pages.
definePageMeta({ middleware: 'auth-screens' })

const route = useRoute()
const { t } = useI18n()
const auth = useAuth()
const baseURL = useRuntimeConfig().app.baseURL

const action = computed(() => loginAction(route.query.action))
const redirect = computed(() => redirectFromQuery(route.query))
const notice = computed(() => loginNotice(route.query))

// Whether to show «Registrer» (if the API cannot be asked, the link is left out), and the site's name for the shell.
const { data: options } = await useAuthOptions()
const registrationOpen = computed(() => options.value?.registrationOpen === true)

// The second step, from the session: after the password the API holds a half-open session until the code is given.
type Step = 'password' | 'verify' | 'enrol'
const stepFromSession = computed<Step>(() => {
  const session = auth.session.value
  if (session.status !== 'mfa_required') return 'password'
  return session.mfa === 'enrolment' ? 'enrol' : 'verify'
})
// True while a second-step component has the floor: the session turns complete before it is done (warning about few
// recovery codes, the recovery codes themselves), and the step must not be swapped for the form meanwhile.
const holding = ref(false)
const lastStep = ref<Step>(stepFromSession.value)
watchEffect(() => {
  if (!holding.value) lastStep.value = stepFromSession.value
})
const step = computed<Step>(() => (holding.value ? lastStep.value : stepFromSession.value))

// The message a step left when the session ran out under it.
const expired = ref<string>()

const screen = computed(() => {
  switch (action.value) {
    case 'lostpassword':
      return 'lost'
    case 'resetpass':
      return 'reset'
    case 'setpassword':
      return 'set'
    case 'confirmemail':
      return 'confirm'
    default:
      return step.value
  }
})

const heading = computed(() => {
  switch (screen.value) {
    case 'lost':
      return t('auth.lost.heading')
    case 'reset':
      return t('auth.choose.headingReset')
    case 'set':
      return t('auth.choose.headingSet')
    case 'confirm':
      return t('auth.confirm.heading')
    case 'verify':
      return t('auth.mfa.heading')
    case 'enrol':
      return t('auth.enrol.heading')
    default:
      return t('auth.login.heading')
  }
})

useSeoMeta({ title: () => t('auth.title', { page: heading.value }) })

/** Where the sign-in leads. A `#token=` kept in the address for the confirm-e-mail detour goes along. */
async function leave(path: string | undefined) {
  const target = redirectTarget(path, baseURL)
  const hash = route.hash.startsWith('#token=') ? route.hash : ''
  if (target.kind === 'route') {
    await navigateTo(`${target.to}${hash}`)
  } else {
    await navigateTo(`${target.href}${hash}`, { external: true })
  }
}

async function onSubmitted(answer: LoginResponse) {
  expired.value = undefined
  if (answer.status === 'authenticated') {
    await leave(answer.redirectTo)
  }
  // Otherwise a second step is needed; the session says which, and `step` follows it.
}

function onExpired(message: string) {
  holding.value = false
  expired.value = message
}

async function onConfirmNeedsLogin() {
  // Back here after the login. The token stays in the fragment of the address for the trip.
  await navigateTo({
    path: '/login',
    query: { redirectTo: `${baseURL.replace(/\/+$/, '')}/login?action=confirmemail` },
    hash: route.hash,
  })
}

async function onPasswordChosen() {
  await navigateTo({ path: '/login', query: NOTICE_QUERY.passwordChanged })
}

async function onLostSent() {
  await navigateTo({ path: '/login', query: NOTICE_QUERY.checkEmail })
}

const noticeKind = computed(() =>
  notice.value === 'loggedOut' || notice.value === 'passwordChanged' ? 'success' : 'info',
)
</script>

<template>
  <AuthShell :heading="heading">
    <template v-if="screen === 'password'">
      <AuthMessage v-if="expired" kind="error">{{ expired }}</AuthMessage>
      <AuthMessage v-else-if="notice" :kind="noticeKind">
        <template v-if="notice === 'loggedOut'">{{ $t('auth.notice.loggedOut') }}</template>
        <template v-else-if="notice === 'passwordChanged'">{{ $t('auth.notice.passwordChanged') }}</template>
        <template v-else-if="notice === 'checkEmail'">{{ $t('auth.notice.checkEmail') }}</template>
        <template v-else>{{ $t('auth.notice.registered') }}</template>
      </AuthMessage>
      <AuthLoginForm :redirect-to="redirect" @submitted="onSubmitted" />
    </template>

    <AuthMfaVerify
      v-else-if="screen === 'verify'"
      v-model:holding="holding"
      @verified="leave(redirect)"
      @expired="onExpired"
    />
    <AuthMfaEnrol
      v-else-if="screen === 'enrol'"
      v-model:holding="holding"
      @finished="leave(redirect)"
      @expired="onExpired"
    />
    <AuthLostPassword v-else-if="screen === 'lost'" @sent="onLostSent" />
    <AuthChoosePassword v-else-if="screen === 'reset'" mode="reset" @done="onPasswordChosen" />
    <AuthChoosePassword v-else-if="screen === 'set'" mode="set" @done="onPasswordChosen" />
    <AuthConfirmEmail v-else-if="screen === 'confirm'" @needs-login="onConfirmNeedsLogin" />

    <template #links>
      <template v-if="screen === 'password'">
        <AuthLink v-if="registrationOpen" to="/register">{{ $t('auth.links.register') }}</AuthLink>
        <AuthLink :to="{ path: '/login', query: { action: 'lostpassword' } }">{{ $t('auth.links.lost') }}</AuthLink>
      </template>
      <template v-else-if="screen === 'lost'">
        <AuthLink to="/login">{{ $t('auth.links.login') }}</AuthLink>
        <AuthLink v-if="registrationOpen" to="/register">{{ $t('auth.links.register') }}</AuthLink>
      </template>
      <template v-else-if="screen === 'reset' || screen === 'set'">
        <AuthLink to="/login">{{ $t('auth.links.login') }}</AuthLink>
      </template>
    </template>
  </AuthShell>
</template>
