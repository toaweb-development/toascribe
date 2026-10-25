<script setup lang="ts">
// «Velkommen til toascribe!» (WordPress' welcome panel): a few links that work now. «Avvis» is kept in the account's preferences
// (`dismissedWelcome`), so it stays dismissed on every device. Hidden once dismissed.
const { t } = useI18n()
const auth = useAuth()
const { preferences, failed, reload, update } = useAdminPreferences()

const canListUsers = computed(
  () => auth.session.value.status === 'authenticated' && auth.session.value.account.capabilities.includes('list_users'),
)

const saving = ref(false)
const failure = ref<string>()

async function dismiss() {
  saving.value = true
  failure.value = undefined
  try {
    await update({ dismissedWelcome: true })
    // The panel is gone with the focus on its button: focus goes to the dashboard's main region.
    await nextTick()
    document.getElementById('main-content')?.focus({ preventScroll: true })
  } catch (caught) {
    failure.value = describeApiError(caught, t)
  } finally {
    saving.value = false
  }
}

const retrying = ref(false)
async function retry() {
  retrying.value = true
  await reload()
  retrying.value = false
}
</script>

<template>
  <UCard v-if="preferences && !preferences.dismissedWelcome" as="section" aria-labelledby="welcome-heading">
    <template #header>
      <h2 id="welcome-heading" class="text-lg font-semibold text-highlighted">{{ $t('dashboard.welcome.heading') }}</h2>
    </template>

    <p class="text-base text-default">{{ $t('dashboard.welcome.intro') }}</p>
    <ul class="mt-3 flex flex-col gap-1">
      <li>
        <ULink
          to="/profile"
          class="inline-flex min-h-11 items-center text-primary underline underline-offset-4 hover:no-underline"
        >
          {{ $t('dashboard.welcome.profile') }}
        </ULink>
      </li>
      <li v-if="canListUsers">
        <ULink
          to="/users"
          class="inline-flex min-h-11 items-center text-primary underline underline-offset-4 hover:no-underline"
        >
          {{ $t('dashboard.welcome.users') }}
        </ULink>
      </li>
    </ul>
    <p v-if="failure" role="alert" class="mt-3 font-medium text-error">
      {{ $t('dashboard.welcome.dismissFailed') }} {{ failure }}
    </p>

    <template #footer>
      <UButton color="neutral" variant="outline" size="lg" class="min-h-11" :loading="saving" @click="dismiss">
        {{ $t('dashboard.welcome.dismiss') }}
      </UButton>
    </template>
  </UCard>

  <UAlert
    v-else-if="!preferences && failed"
    color="error"
    variant="subtle"
    role="alert"
    :title="$t('dashboard.welcome.failed.title')"
  >
    <template #description>
      <p>{{ $t('dashboard.welcome.failed.text') }}</p>
    </template>
    <template #actions>
      <UButton color="neutral" variant="outline" size="lg" class="min-h-11" :loading="retrying" @click="retry">
        {{ $t('dashboard.welcome.failed.retry') }}
      </UButton>
    </template>
  </UAlert>
</template>
