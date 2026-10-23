<script setup lang="ts">
import type { LoginResponse, SetupEmailSaved, SetupSite } from '@toascribe/shared'

import type { AdminDraft } from './StepAdmin.vue'

// The setup wizard (M0.4): seven steps, in the order of Tor's specification. It holds what the steps share (the setup code,
// what the api has saved, the administrator's draft) and moves between them. The api saves the site and e-mail steps as they
// are done; a reload asks it where to start. The administrator and the default content are made at the very end, in one
// transaction, by «Fullfør installasjonen».
//
// The setup code comes with the address (`?token=`), is moved into this tab's session storage and removed from the address
// bar at once (utils/setup-token.ts), and is sent in the `X-Setup-Token` header only.
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const setupApi = useSetupApi()
const auth = useAuth()
const installedState = useState<boolean | undefined>('setup:installed')

const STEP_COUNT = WIZARD_STEPS.length

// 'starting' is the moment the code from the address (or this tab's storage) is checked and the saved steps are read.
const phase = ref<'starting' | 'ready' | 'signin'>('starting')

const token = ref<string>()
const tokenNotice = ref<string>()
const step = ref(0)
const current = computed(() => WIZARD_STEPS[step.value] ?? 'token')

const savedSite = ref<SetupSite | null>(null)
const savedEmail = ref<SetupEmailSaved | null>(null)
const emailSkipped = ref(false)
const emailOutcome = ref<'tested' | 'skipped'>()
const draft = ref<AdminDraft | null>(null)
const recoveryKey = ref('')
const adminProblem = ref<string>()

const titles = computed(() => [
  t('setup.steps.token.title'),
  t('setup.steps.check.title'),
  t('setup.steps.site.title'),
  t('setup.steps.email.title'),
  t('setup.steps.admin.title'),
  t('setup.steps.content.title'),
  t('setup.steps.finish.title'),
])
const headings = computed(() => [
  t('setup.steps.token.heading'),
  t('setup.steps.check.heading'),
  t('setup.steps.site.heading'),
  t('setup.steps.email.heading'),
  t('setup.steps.admin.heading'),
  t('setup.steps.content.heading'),
  t('setup.steps.finish.heading'),
])
const heading = computed(() =>
  t('setup.stepHeading', { n: step.value + 1, total: STEP_COUNT, title: headings.value[step.value] ?? '' }),
)

/**
 * The stepper's items. The name of a step button is its title; where the step stands (done, current, not reached) is its
 * description, which the button points to and which is hidden from the eye (the number and the check mark say it there). The
 * number on the button is drawn from an attribute (`before:content-[attr(data-n)]`), so it is not text that the name has to contain
 * (axe: label-content-name-mismatch).
 */
const items = computed(() =>
  titles.value.map((title, value) => ({
    title,
    value,
    description:
      value < step.value
        ? t('setup.stepper.done')
        : value === step.value
          ? t('setup.stepper.current')
          : t('setup.stepper.todo'),
  })),
)

// A step replaces the one before it under the person's hands: focus goes to its heading, so it is read from the top and the
// next Tab reaches its first control. Not on arrival: the browser starts at the top of a new page by itself.
const headingElement = useTemplateRef<HTMLElement>('headingElement')
let arrived = false
watch(step, async () => {
  if (!arrived) {
    return
  }
  await nextTick()
  headingElement.value?.focus()
})

function go(index: number) {
  step.value = Math.min(Math.max(index, 0), STEP_COUNT - 1)
}

function goTo(value: number | string | undefined) {
  // The stepper lets a person back to a step they have done; a step they have not reached stays shut.
  if (typeof value === 'number' && value <= step.value) {
    go(value)
  }
}

/** The site is installed (the api says so with a 404 on a setup route): the wizard is over; the way on is the login. */
async function onInstalled() {
  installedState.value = true
  clearStoredToken()
  await navigateTo('/login')
}

/** The api does not accept the setup code: back to the first step with the reason. */
function onTokenLost(message: string) {
  token.value = undefined
  clearStoredToken()
  tokenNotice.value = message
  go(0)
}

/** Reads what the api has saved, and returns the step to be on. */
async function loadState(code: string): Promise<number> {
  const saved = await setupApi.state(code)
  savedSite.value = saved.site
  savedEmail.value = saved.email
  emailSkipped.value = saved.emailSkipped
  if (saved.emailSkipped) {
    emailOutcome.value = 'skipped'
  }
  return stepFor(saved.nextStep)
}

/** Checks a code with the api, keeps it for this tab, and moves to the first step that is not saved (never back to the code). */
async function acceptToken(code: string, options: { jump: boolean }) {
  try {
    await setupApi.verifyToken(code)
    const target = await loadState(code)
    token.value = code
    tokenNotice.value = undefined
    storeToken(code)
    if (options.jump) {
      go(Math.max(target, 1))
    }
  } catch (caught) {
    const failure = classifySetupFailure(caught)
    if (failure.kind === 'installed') {
      await onInstalled()
      return
    }
    if (failure.kind === 'token') {
      clearStoredToken()
    }
    token.value = undefined
    tokenNotice.value = describeApiError(caught, t)
    go(0)
  }
}

async function onTokenPasted(code: string) {
  // The pasted code was checked by the form; the saved steps are read now. The person sees the "accepted" panel and goes on.
  await acceptToken(code, { jump: false })
}

async function start() {
  const taken = takeTokenFromQuery(route.query)
  if (taken.present) {
    // Out of the address bar before anything else, and without adding a history entry.
    await router.replace({ path: route.path, query: taken.rest, hash: route.hash })
  }
  const code = taken.token ?? readStoredToken()
  if (code === undefined) {
    if (taken.present) {
      tokenNotice.value = t('setup.token.badAddress')
    }
  } else {
    await acceptToken(code, { jump: true })
  }
  phase.value = 'ready'
  await nextTick()
  arrived = true
}

onMounted(start)

function onSiteSaved(site: SetupSite) {
  savedSite.value = site
  go(3)
}

function onEmailDone() {
  emailOutcome.value = 'tested'
  emailSkipped.value = false
  go(4)
}

function onEmailSkipped() {
  emailOutcome.value = 'skipped'
  emailSkipped.value = true
  go(4)
}

function onAdminReady(admin: AdminDraft, key: string) {
  draft.value = admin
  recoveryKey.value = key
  adminProblem.value = undefined
  go(5)
}

/** The install refused the account or the key: the administrator step fixes it, and keeps what was typed. */
function onFix(_code: string, message: string) {
  adminProblem.value = message
  go(4)
}

/** A step the api has not saved: ask it which, and go there. */
async function onMissing() {
  if (token.value === undefined) {
    return
  }
  try {
    go(await loadState(token.value))
  } catch (caught) {
    onTokenLost(describeApiError(caught, t))
  }
}

async function onDone(login: LoginResponse | null) {
  installedState.value = true
  clearStoredToken()
  if (login === null) {
    // The site is installed, but the session could not be made: the person signs in.
    phase.value = 'signin'
    return
  }
  auth.adopt(login)
  await navigateTo('/')
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <p v-if="phase === 'starting'" role="status" class="text-base text-default">{{ $t('setup.starting') }}</p>

    <AuthMessage v-else-if="phase === 'signin'" kind="info" focus>
      {{ $t('setup.finish.signin') }}
      <NuxtLink to="/login" class="ml-1 inline-flex min-h-11 items-center text-primary underline underline-offset-4">{{
        $t('auth.links.login')
      }}</NuxtLink>
    </AuthMessage>

    <template v-else>
      <!-- Under lg the progress is the bar and the step's heading; from lg the stepper shows every step. -->
      <div class="lg:hidden" aria-hidden="true">
        <UProgress :model-value="step + 1" :max="STEP_COUNT" size="sm" />
      </div>
      <UStepper
        :model-value="step"
        :items="items"
        size="sm"
        class="hidden lg:flex"
        :ui="{ title: 'text-sm', description: 'sr-only' }"
        @update:model-value="goTo"
      >
        <template #indicator="{ item }">
          <UIcon v-if="Number(item.value) < step" name="i-lucide-check" aria-hidden="true" class="size-4" />
          <span v-else aria-hidden="true" :data-n="Number(item.value) + 1" class="before:content-[attr(data-n)]" />
        </template>
      </UStepper>

      <UCard>
        <h2 ref="headingElement" tabindex="-1" class="mb-6 text-xl font-semibold text-highlighted outline-none">
          {{ heading }}
        </h2>

        <SetupStepToken
          v-if="current === 'token'"
          :accepted="token !== undefined"
          :notice="tokenNotice"
          @accepted="onTokenPasted"
          @installed="onInstalled"
          @next="go(1)"
        />

        <template v-else-if="token !== undefined">
          <SetupStepCheck
            v-if="current === 'check'"
            :token="token"
            @installed="onInstalled"
            @lost="onTokenLost"
            @back="go(0)"
            @next="go(2)"
          />
          <SetupStepSite
            v-else-if="current === 'site'"
            :token="token"
            :saved="savedSite"
            @installed="onInstalled"
            @lost="onTokenLost"
            @back="go(1)"
            @saved="onSiteSaved"
          />
          <SetupStepEmail
            v-else-if="current === 'email'"
            :token="token"
            :saved="savedEmail"
            :skipped="emailSkipped"
            :admin-email="savedSite?.adminEmail ?? ''"
            @installed="onInstalled"
            @lost="onTokenLost"
            @back="go(2)"
            @done="onEmailDone"
            @skipped="onEmailSkipped"
          />
          <SetupStepAdmin
            v-else-if="current === 'admin'"
            :token="token"
            :draft="draft"
            :default-email="savedSite?.adminEmail ?? ''"
            :site-title="savedSite?.title ?? ''"
            :problem="adminProblem"
            @installed="onInstalled"
            @lost="onTokenLost"
            @back="go(3)"
            @ready="onAdminReady"
          />
          <SetupStepContent
            v-else-if="current === 'content'"
            :locale="savedSite?.locale ?? 'nb'"
            @back="go(4)"
            @next="go(6)"
          />
          <SetupStepFinish
            v-else-if="current === 'finish' && savedSite !== null && draft !== null"
            :token="token"
            :site="savedSite"
            :email="emailOutcome ?? 'skipped'"
            :admin="draft"
            :recovery-key="recoveryKey"
            @installed="onInstalled"
            @lost="onTokenLost"
            @fix="onFix"
            @missing="onMissing"
            @back="go(5)"
            @done="onDone"
          />
        </template>
      </UCard>
    </template>
  </div>
</template>
