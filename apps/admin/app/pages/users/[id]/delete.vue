<script setup lang="ts">
import { USERS_SEARCH_MAX_LENGTH } from '@toascribe/shared'
import type { UserListItem } from '@toascribe/shared'

// «Slett bruker» (K-021; WordPress' users.php?action=delete): who is deleted, and when the account has content, what happens to
// it: «Slett alt innhold» or «Tilordne alt innhold til» another account. «Bekreft sletting» does it. The api refuses one's own
// account and the last administrator, and says so here.
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t } = useI18n()
useSeoMeta({ title: () => t('users.delete.title') })

const route = useRoute()
const auth = useAuth()
const usersApi = useUsersApi()
const id = computed(() => String(route.params['id'] ?? ''))
const me = computed(() => (auth.session.value.status === 'authenticated' ? auth.session.value.account : undefined))
const mayDelete = computed(() => me.value?.capabilities.includes('delete_users') === true)
if (import.meta.server && !mayDelete.value) {
  const event = useRequestEvent()
  if (event) setResponseStatus(event, 403)
}

const { data: user, error } = await useAsyncData(`users:delete:${id.value}`, () => usersApi.get(id.value), {
  enabled: mayDelete,
})
// The new owner: the accounts that match what is typed (the api searches, so a site with thousands of users works), and always the
// signed-in administrator, who is the default.
const heirSearch = ref('')
// Asked for when the typing pauses, not at every key.
const heirQuery = ref('')
let pause: ReturnType<typeof setTimeout> | undefined
watch(heirSearch, (text) => {
  clearTimeout(pause)
  pause = setTimeout(() => {
    heirQuery.value = text.trim().slice(0, USERS_SEARCH_MAX_LENGTH)
  }, 300)
})
onBeforeUnmount(() => clearTimeout(pause))
const { data: others } = await useAsyncData(
  `users:delete:others:${id.value}`,
  async (): Promise<UserListItem[]> =>
    (
      await usersApi.list({
        orderby: 'username',
        order: 'asc',
        page: 1,
        per_page: 50,
        ...(heirQuery.value === '' ? {} : { search: heirQuery.value }),
      })
    ).users.filter((other) => other.id !== id.value && other.status === 'active'),
  { enabled: mayDelete, watch: [heirQuery] },
)
// The chosen owner stays in the list after the search is cleared, so the button keeps their name, never an id.
const chosenHeir = ref<{ value: string; label: string }>()
const heirItems = computed(() => {
  const items = (others.value ?? []).map((other) => ({
    value: other.id,
    label: `${other.username} (${other.displayName})`,
  }))
  const self = me.value
  const extra: { value: string; label: string }[] = []
  if (self !== undefined && self.id !== id.value) {
    extra.push({ value: self.id, label: `${self.username} (${self.displayName})` })
  }
  if (chosenHeir.value !== undefined) extra.push(chosenHeir.value)
  const missing = extra.filter(
    (item, index) =>
      !items.some((other) => other.value === item.value) && extra.findIndex((e) => e.value === item.value) === index,
  )
  return [...missing, ...items]
})

const choice = ref<'delete' | 'reassign'>('reassign')
const heir = ref<string | undefined>(me.value?.id)
watch(heir, (value) => {
  const item = heirItems.value.find((candidate) => candidate.value === value)
  if (item !== undefined) chosenHeir.value = item
})
const saving = ref(false)
const failure = ref<string>()

const choiceItems = computed(() => [
  { value: 'delete', label: t('users.delete.deleteAll') },
  { value: 'reassign', label: t('users.delete.reassign') },
])

async function confirmDelete(): Promise<void> {
  if (saving.value || !user.value) return
  if (user.value.contentCount > 0 && choice.value === 'reassign' && heir.value === undefined) {
    failure.value = t('users.delete.chooseHeir')
    return
  }
  failure.value = undefined
  saving.value = true
  try {
    await usersApi.remove(id.value, {
      reassignTo: user.value.contentCount > 0 && choice.value === 'reassign' ? (heir.value ?? null) : null,
    })
    await navigateTo({ path: '/users', query: { deleted: user.value.username } })
  } catch (caught) {
    const code = caught instanceof ApiRequestError ? caught.code : undefined
    failure.value =
      code === 'last_administrator'
        ? t('users.delete.lastAdministrator')
        : code === 'self'
          ? t('users.delete.self')
          : describeApiError(caught, t)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="users-delete">
    <template #header>
      <UDashboardNavbar :title="$t('users.delete.title')" />
    </template>
    <template #body>
      <section v-if="!mayDelete" aria-labelledby="users-delete-denied" class="flex max-w-prose flex-col gap-3">
        <h2 id="users-delete-denied" class="text-xl font-semibold text-highlighted">{{ $t('users.denied.title') }}</h2>
        <p class="text-base text-default">{{ $t('users.delete.denied') }}</p>
      </section>
      <UAlert
        v-else-if="error || !user"
        color="error"
        variant="subtle"
        role="alert"
        icon="i-lucide-triangle-alert"
        :title="$t('users.delete.notFound')"
      />
      <form v-else class="flex max-w-2xl flex-col gap-6" @submit.prevent="confirmDelete">
        <p class="text-base text-default">{{ $t('users.delete.intro') }}</p>
        <p class="font-medium text-highlighted">{{ user.username }} ({{ user.email }})</p>
        <fieldset v-if="user.contentCount > 0" class="flex flex-col gap-3">
          <legend class="mb-2 font-semibold text-highlighted">
            {{ $t('users.delete.contentQuestion', user.contentCount) }}
          </legend>
          <URadioGroup v-model="choice" :items="choiceItems" />
          <UFormField v-if="choice === 'reassign'" :label="$t('users.delete.heir')" name="heir">
            <USelectMenu
              v-model="heir"
              v-model:search-term="heirSearch"
              :items="heirItems"
              value-key="value"
              ignore-filter
              size="xl"
              class="w-full sm:w-96"
            />
          </UFormField>
        </fieldset>
        <UAlert
          v-if="failure"
          color="error"
          variant="subtle"
          role="alert"
          icon="i-lucide-triangle-alert"
          :title="$t('users.delete.failed')"
          :description="failure"
        />
        <div class="flex flex-wrap gap-3">
          <UButton type="submit" color="error" size="lg" class="min-h-11" :loading="saving">
            {{ $t('users.delete.submit') }}
          </UButton>
          <UButton to="/users" color="neutral" variant="outline" size="lg" class="min-h-11">
            {{ $t('profile.cancel') }}
          </UButton>
        </div>
      </form>
    </template>
  </UDashboardPanel>
</template>
