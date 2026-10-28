<script setup lang="ts">
import type { UserRoleOption } from '@toascribe/shared'

// «Brukere → Legg til ny» (K-020; WordPress' user-new.php): username, e-mail, first and last name, website, role, and either an
// invitation by e-mail (the account waits for its own password, from a link valid 24 hours) or a password set here. Only the roles
// the signed-in account may give are offered; the api checks the same.
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t } = useI18n()
useSeoMeta({ title: () => t('users.new.title') })

const auth = useAuth()
const usersApi = useUsersApi()
const mayCreate = computed(
  () =>
    auth.session.value.status === 'authenticated' && auth.session.value.account.capabilities.includes('create_users'),
)
if (import.meta.server && !mayCreate.value) {
  const event = useRequestEvent()
  if (event) setResponseStatus(event, 403)
}

const { data: roles } = await useAsyncData(
  'users:new:roles',
  async (): Promise<UserRoleOption[]> =>
    (await usersApi.list({ orderby: 'username', order: 'asc', page: 1, per_page: 1 })).roles.filter(
      (role) => role.grantable,
    ),
  { enabled: mayCreate },
)
const roleItems = computed(() =>
  (roles.value ?? []).map((role) => ({ value: role.slug, label: roleLabel(t, role.slug, role.name) })),
)

const form = reactive({
  username: '',
  email: '',
  firstName: '',
  lastName: '',
  website: '',
  role: 'subscriber',
  sendInvite: true,
  password: '',
})
const saving = ref(false)
const failure = ref<string>()

async function submit(): Promise<void> {
  if (saving.value) return
  failure.value = undefined
  saving.value = true
  try {
    const created = await usersApi.create({
      username: form.username.trim(),
      email: form.email.trim(),
      ...(form.firstName.trim() === '' ? {} : { firstName: form.firstName.trim() }),
      ...(form.lastName.trim() === '' ? {} : { lastName: form.lastName.trim() }),
      ...(form.website.trim() === '' ? {} : { website: form.website.trim() }),
      role: form.role,
      sendInvite: form.sendInvite,
      ...(form.sendInvite ? {} : { password: form.password }),
    })
    await navigateTo({
      path: '/users',
      query: { created: created.username, ...(created.invited ? { invited: '1' } : {}) },
    })
  } catch (caught) {
    const code = caught instanceof ApiRequestError ? caught.code : undefined
    failure.value =
      code === 'username_taken'
        ? t('users.new.usernameTaken')
        : code === 'email_taken'
          ? t('users.new.emailTaken')
          : code === 'weak_password'
            ? t('users.new.weakPassword')
            : describeApiError(caught, t)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="users-new">
    <template #header>
      <UDashboardNavbar :title="$t('users.new.title')" />
    </template>
    <template #body>
      <section v-if="!mayCreate" aria-labelledby="users-new-denied" class="flex max-w-prose flex-col gap-3">
        <h2 id="users-new-denied" class="text-xl font-semibold text-highlighted">{{ $t('users.denied.title') }}</h2>
        <p class="text-base text-default">{{ $t('users.new.denied') }}</p>
      </section>
      <form v-else class="flex max-w-2xl flex-col gap-6" @submit.prevent="submit">
        <p class="max-w-prose text-base text-default">{{ $t('users.new.intro') }}</p>
        <UFormField :label="$t('users.new.username')" :help="$t('users.new.usernameHelp')" name="username" required>
          <UInput
            v-model="form.username"
            autocomplete="off"
            spellcheck="false"
            size="xl"
            class="w-full sm:w-96"
            required
          />
        </UFormField>
        <UFormField :label="$t('users.new.email')" name="email" required>
          <UInput v-model="form.email" type="email" autocomplete="off" size="xl" class="w-full sm:w-96" required />
        </UFormField>
        <div class="grid gap-6 sm:grid-cols-2">
          <UFormField :label="$t('users.new.firstName')" name="firstName">
            <UInput v-model="form.firstName" size="xl" class="w-full" />
          </UFormField>
          <UFormField :label="$t('users.new.lastName')" name="lastName">
            <UInput v-model="form.lastName" size="xl" class="w-full" />
          </UFormField>
        </div>
        <UFormField :label="$t('users.new.website')" name="website">
          <UInput v-model="form.website" type="url" size="xl" class="w-full sm:w-96" />
        </UFormField>
        <UFormField :label="$t('users.new.role')" name="role">
          <USelect v-model="form.role" :items="roleItems" size="xl" class="w-full sm:w-64" />
        </UFormField>
        <UCheckbox
          v-model="form.sendInvite"
          :label="$t('users.new.sendInvite')"
          :description="$t('users.new.sendInviteHelp')"
        />
        <AuthNewPasswordFields
          v-if="!form.sendInvite"
          v-model="form.password"
          :label="$t('users.new.password')"
          :help="$t('users.new.passwordHelp')"
        />
        <UAlert
          v-if="failure"
          color="error"
          variant="subtle"
          role="alert"
          icon="i-lucide-triangle-alert"
          :title="$t('users.new.failed')"
          :description="failure"
        />
        <div>
          <UButton type="submit" size="lg" class="min-h-11" :loading="saving">{{ $t('users.new.submit') }}</UButton>
        </div>
      </form>
    </template>
  </UDashboardPanel>
</template>
