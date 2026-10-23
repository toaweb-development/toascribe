<script setup lang="ts">
import type { LoginResponse, SetupSite } from '@toascribe/shared'

// Step 7: finish. The page repeats the choices, and «Fullfør installasjonen» sends them: the administrator, the default
// content and the `installed` flag are written in one transaction, the person is signed in (the answer sets the session
// cookie) and the wizard goes on to the admin. Until then nothing about the account exists.
const props = defineProps<{
  token: string
  site: SetupSite
  /** What happened to the e-mail step: a test mail went out, or it was skipped. */
  email: 'tested' | 'skipped'
  admin: { username: string; email: string; password: string }
  recoveryKey: string
}>()

const emit = defineEmits<{
  /** The site is installed. `login` is null when the session could not be made: sign in at the login screen. */
  done: [login: LoginResponse | null]
  installed: []
  lost: [message: string]
  /** The api refused the administrator or the key: that step fixes it. */
  fix: [code: string, message: string]
  /** The api says a step is not saved (the wizard asks which). */
  missing: []
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

const language = computed(() =>
  props.site.locale === 'nb' ? t('setup.site.language.nb') : t('setup.site.language.en'),
)

async function install() {
  const { username, email, password } = props.admin
  let failure: { code: string; message: string } | undefined
  const answer = await run(async () => {
    try {
      return await setupApi.install(props.token, {
        admin: { username, email, password },
        recoveryKey: props.recoveryKey,
        confirmed: true,
      })
    } catch (caught) {
      if (caught instanceof ApiRequestError) {
        failure = { code: caught.code, message: describeApiError(caught, t) }
      }
      throw caught
    }
  })
  if (answer !== undefined) {
    emit('done', answer.login)
    return
  }
  if (failure !== undefined) {
    if (isAdminStepFailure(failure.code)) {
      emit('fix', failure.code, failure.message)
    } else if (failure.code === 'step_missing') {
      emit('missing')
    }
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <p class="text-base text-default">{{ $t('setup.finish.intro') }}</p>
    <AuthMessage v-if="error" :key="failures" kind="error" focus>{{ error }}</AuthMessage>

    <dl class="grid grid-cols-1 gap-x-6 gap-y-3 rounded-md border border-default p-4 sm:grid-cols-3">
      <dt class="text-sm font-semibold text-toned">{{ $t('setup.finish.siteTitle') }}</dt>
      <dd class="text-base break-words text-default sm:col-span-2">{{ site.title }}</dd>
      <dt class="text-sm font-semibold text-toned">{{ $t('setup.finish.language') }}</dt>
      <dd class="text-base text-default sm:col-span-2">{{ language }}</dd>
      <dt class="text-sm font-semibold text-toned">{{ $t('setup.finish.timezone') }}</dt>
      <dd class="text-base text-default sm:col-span-2">{{ site.timezone }}</dd>
      <dt class="text-sm font-semibold text-toned">{{ $t('setup.finish.search') }}</dt>
      <dd class="text-base text-default sm:col-span-2">
        {{ site.blogPublic ? $t('setup.finish.searchAllowed') : $t('setup.finish.searchDiscouraged') }}
      </dd>
      <dt class="text-sm font-semibold text-toned">{{ $t('setup.finish.email') }}</dt>
      <dd class="text-base text-default sm:col-span-2">
        {{ email === 'tested' ? $t('setup.finish.emailTested') : $t('setup.finish.emailSkipped') }}
      </dd>
      <dt class="text-sm font-semibold text-toned">{{ $t('setup.finish.admin') }}</dt>
      <dd class="text-base break-words text-default sm:col-span-2">
        {{ $t('setup.finish.adminValue', { username: admin.username, email: admin.email }) }}
      </dd>
      <dt class="text-sm font-semibold text-toned">{{ $t('setup.finish.key') }}</dt>
      <dd class="text-base text-default sm:col-span-2">{{ $t('setup.finish.keyValue') }}</dd>
    </dl>

    <p role="status" class="text-sm text-toned">{{ pending ? $t('setup.finish.working') : '' }}</p>

    <div class="flex flex-wrap gap-2">
      <UButton color="neutral" variant="outline" size="xl" class="min-h-11" :disabled="pending" @click="emit('back')">{{
        $t('setup.nav.back')
      }}</UButton>
      <UButton size="xl" class="min-h-11" :loading="pending" @click="install">{{ $t('setup.finish.submit') }}</UButton>
    </div>
  </div>
</template>
