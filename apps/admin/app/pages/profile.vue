<script setup lang="ts">
import type { MeResponse } from '@toascribe/shared'

// «Profil» (WordPress' profile.php): one long page, no tabs. In WordPress' order: personal choices (saved as they are made), name,
// contact, biography (saved with «Oppdater profil»), and account management (password, second factor, sessions: each a security
// action with its own button, because each asks for the current password or confirms). Every part loads, fails and retries by itself,
// so one that cannot load does not stop the others.
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t } = useI18n()
useSeoMeta({ title: () => t('profile.title') })

const meApi = useMeApi()
const { data: me, error, refresh } = await useAsyncData('profile:me', () => meApi.get())

const dirty = ref(false)
useUnsavedGuard(() => dirty.value)

const retrying = ref(false)
async function retry() {
  retrying.value = true
  await refresh()
  retrying.value = false
}

function saved(next: MeResponse) {
  me.value = next
}
</script>

<template>
  <UDashboardPanel id="profile">
    <template #header>
      <UDashboardNavbar :title="$t('profile.title')" />
    </template>

    <template #body>
      <div class="mx-auto flex w-full max-w-3xl flex-col gap-4 sm:gap-6">
        <ProfilePersonal />

        <UAlert
          v-if="!me"
          color="error"
          variant="subtle"
          role="alert"
          :title="$t('profile.loadFailed.title')"
          :description="error ? $t('profile.loadFailed.text') : undefined"
        >
          <template #actions>
            <UButton color="neutral" variant="outline" size="lg" class="min-h-11" :loading="retrying" @click="retry">
              {{ $t('profile.retry') }}
            </UButton>
          </template>
        </UAlert>
        <template v-else>
          <ProfileAvatar :me="me" @saved="saved" />
          <ProfileDetails v-model:dirty="dirty" :me="me" @saved="saved" />
        </template>

        <section aria-labelledby="account-heading" class="flex flex-col gap-4 sm:gap-6">
          <h2 id="account-heading" class="text-xl font-semibold text-highlighted">{{ $t('profile.account.title') }}</h2>
          <ProfilePassword />
          <ProfileTwoFactor />
          <ProfileSessions />
          <ProfileAppPasswords />
        </section>
      </div>
    </template>
  </UDashboardPanel>
</template>
