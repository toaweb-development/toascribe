<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

import type { UserListResponse } from '@toascribe/shared'

import type { RoleChangeReport } from '~/utils/users-messages'
import type { UsersView } from '~/utils/users-query'

// «Brukere» (WordPress' users.php): the accounts, their roles, and a bulk change of role. Editing and deleting others come later, so
// there are no row actions. The state of the list (view, search, sort, page) is in the address, so a reload, the back button and a link
// show the same list (workflows §7); the page reads it from the route and every control is a link or a form that changes it.
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t } = useI18n()
useSeoMeta({ title: () => t('users.title') })

const route = useRoute()
const router = useRouter()
const auth = useAuth()
const usersApi = useUsersApi()
const confirm = useConfirmDialog()

const account = computed(() => (auth.session.value.status === 'authenticated' ? auth.session.value.account : undefined))
const mayList = computed(() => account.value?.capabilities.includes('list_users') === true)
const mayPromote = computed(() => account.value?.capabilities.includes('promote_users') === true)

// The menu hides this page from an account that may not list users; a typed address still lands here, and it says so and why.
if (import.meta.server && !mayList.value) {
  const event = useRequestEvent()
  if (event) {
    setResponseStatus(event, 403)
  }
}

const view = computed(() => parseUsersView(route.query))
const forbidden = ref(false)

const { data, status, error, refresh } = await useAsyncData(
  'users:list',
  async (): Promise<UserListResponse | null> => {
    forbidden.value = false
    if (!mayList.value) {
      return null
    }
    try {
      return await usersApi.list(toUserListQuery(view.value))
    } catch (caught) {
      forbidden.value = caught instanceof ApiRequestError && caught.status === 403
      throw caught
    }
  },
  { watch: [view] },
)

const denied = computed(() => !mayList.value || forbidden.value)
const users = computed(() => data.value?.users ?? [])
const roleNames = computed(() => new Map((data.value?.roles ?? []).map((role) => [role.slug, role.name])))
const roleName = (slug: string) => roleNames.value.get(slug)
const grantable = computed(() => (data.value?.roles ?? []).filter((role) => role.grantable))
const bulkAvailable = computed(() => mayPromote.value && grantable.value.length > 0)
const filtered = computed(() => view.value.role !== undefined || view.value.search !== '')

/** The address of the list with some of the state changed (see utils/users-query.ts). */
function locationFor(changes: Partial<UsersView>): RouteLocationRaw {
  return { path: route.path, query: usersViewQuery(changeUsersView(view.value, changes)) }
}

function search(text: string) {
  void router.push(locationFor({ search: text }))
}

// --- Selection and the change of role -------------------------------------------------------------------------------------------
const selected = ref<string[]>([])
const role = ref('')
const saving = ref(false)
const report = ref<RoleChangeReport>()
const failure = ref<string>()

// Another list is another set of rows: nothing ticked, and the last message is about a list the person has left.
watch(view, () => {
  selected.value = []
  report.value = undefined
  failure.value = undefined
})
watch(
  () => data.value?.users,
  (rows) => {
    selected.value = selected.value.filter((id) => rows?.some((row) => row.id === id))
  },
)

// A page past the end (an address typed by hand, or the last account of the last page changed out of the view): go to the last page
// that exists. Also once the page is up, because the list that came with the HTML is not a change the watcher sees.
function clampPage(list: UserListResponse | null | undefined) {
  if (list && list.users.length === 0 && list.total > 0 && view.value.page > 1) {
    void router.replace(locationFor({ page: pageCountOf(list.total, list.perPage) }))
  }
}
watch(data, clampPage)
onMounted(() => clampPage(data.value))

async function applyRole() {
  const slug = role.value
  const ids = [...selected.value]
  const option = data.value?.roles.find((entry) => entry.slug === slug)
  if (option === undefined || ids.length === 0) {
    return
  }
  const name = roleLabel(t, slug, option.name)
  report.value = undefined
  failure.value = undefined

  // Taking the administrator role from someone removes their access to everything: ask once, and say how many.
  const administrators = administratorsAmong(users.value, new Set(ids), account.value?.id)
  if (slug !== 'administrator' && administrators.length > 0) {
    const confirmed = await confirm.ask({
      title: t('users.confirm.title', { n: administrators.length }, administrators.length),
      description: t('users.confirm.text', { role: name }, administrators.length),
      confirmLabel: t('users.confirm.submit'),
      cancelLabel: t('profile.cancel'),
      color: 'error',
    })
    if (!confirmed) {
      return
    }
  }

  saving.value = true
  try {
    const response = await usersApi.assignRole({ userIds: ids, role: slug })
    const usernames = new Map(users.value.map((row) => [row.id, row.username]))
    report.value = describeRoleChange({ response, usernames, roleName: name }, t)
    // Those that are done are no longer ticked; the ones that were left alone stay, so the message and the rows belong together.
    selected.value = selected.value.filter((id) => !response.changed.includes(id) && !response.unchanged.includes(id))
    role.value = ''
    await refresh()
  } catch (caught) {
    failure.value =
      roleChangeErrorText(caught instanceof ApiRequestError ? caught.code : undefined, t) ?? describeApiError(caught, t)
  } finally {
    saving.value = false
  }
}

// --- Focus -----------------------------------------------------------------------------------------------------------------------
// A link that was clicked can be gone when the new list is drawn (the last page has no «Neste»): focus then goes to the list's heading,
// so the next Tab starts at the list and a screen reader is told where it is.
const results = useTemplateRef<HTMLElement>('results')
watch(status, async (now, before) => {
  if (import.meta.client && before === 'pending' && now === 'success') {
    await nextTick()
    const active = document.activeElement
    if (!active || active === document.body) {
      results.value?.focus({ preventScroll: true })
    }
  }
})

/** 44 px around every page link below `lg` (`mobile`), Nuxt UI's size from there; the row wraps on a phone (`list`). */
const PAGE_BUTTON = 'min-h-11 min-w-11 lg:min-h-8 lg:min-w-8'

const retrying = ref(false)
async function retry() {
  retrying.value = true
  await refresh()
  retrying.value = false
}
</script>

<template>
  <UDashboardPanel id="users">
    <template #header>
      <UDashboardNavbar :title="$t('users.title')" />
    </template>

    <template #body>
      <div class="flex w-full flex-col gap-4 sm:gap-5">
        <!-- Permission denied (workflows §19, §24): say what is missing and who can give it; no list is asked for. -->
        <section v-if="denied" aria-labelledby="users-denied-heading" class="flex max-w-prose flex-col gap-3">
          <h2 id="users-denied-heading" class="text-xl font-semibold text-highlighted">
            {{ $t('users.denied.title') }}
          </h2>
          <p class="text-base text-default">{{ $t('users.denied.text') }}</p>
          <div>
            <NuxtLink
              to="/"
              class="inline-flex min-h-11 items-center text-primary underline underline-offset-4 hover:no-underline"
            >
              {{ $t('users.denied.back') }}
            </NuxtLink>
          </div>
        </section>

        <template v-else>
          <!-- Loading failed: what failed, what is safe, and a way to try again (workflows §25). Rows already shown stay under it. -->
          <UAlert
            v-if="error"
            color="error"
            variant="subtle"
            role="alert"
            icon="i-lucide-triangle-alert"
            :title="$t('users.failed.title')"
          >
            <template #description>
              <p>{{ data ? $t('users.failed.stale') : $t('users.failed.text') }}</p>
            </template>
            <template #actions>
              <UButton color="neutral" variant="outline" size="lg" class="min-h-11" :loading="retrying" @click="retry">
                {{ $t('users.failed.retry') }}
              </UButton>
            </template>
          </UAlert>

          <UsersViews v-if="data" :counts="data.roleCounts" :roles="data.roles" :view="view" :to="locationFor" />

          <div v-if="data" class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <UsersBulk
              v-if="bulkAvailable"
              v-model:role="role"
              :roles="grantable"
              :selected-count="selected.length"
              :busy="saving"
              @submit="applyRole"
            />
            <UsersSearch :search="view.search" @submit="search" />
          </div>

          <!-- The result of «Endre». A region that is always there, so the text put into it is announced; the error is its own alert. -->
          <div role="status">
            <UAlert
              v-if="report"
              :color="report.tone"
              variant="subtle"
              :icon="
                report.tone === 'success'
                  ? 'i-lucide-circle-check'
                  : report.tone === 'warning'
                    ? 'i-lucide-triangle-alert'
                    : 'i-lucide-info'
              "
              :title="report.title"
            >
              <template v-if="report.details.length > 0" #description>
                <ul class="mt-1 flex list-disc flex-col gap-1 ps-5">
                  <li v-for="line in report.details" :key="line">{{ line }}</li>
                </ul>
              </template>
            </UAlert>
          </div>
          <UAlert
            v-if="failure"
            color="error"
            variant="subtle"
            role="alert"
            icon="i-lucide-triangle-alert"
            :title="$t('users.roleError.title')"
            :description="failure"
          />

          <section v-if="data || status === 'pending'" :aria-busy="status === 'pending'" class="flex flex-col gap-3">
            <h2 ref="results" tabindex="-1" class="sr-only outline-none">{{ $t('users.table.caption') }}</h2>

            <div v-if="data" class="flex flex-wrap items-center gap-x-4 gap-y-1">
              <p role="status" class="text-sm text-toned">{{ $t('users.count', data.total) }}</p>
              <p v-if="view.search !== ''" class="flex flex-wrap items-center gap-x-3 text-sm text-default">
                <span>{{ $t('users.search.summary', { query: view.search }) }}</span>
                <NuxtLink
                  :to="locationFor({ search: '' })"
                  class="inline-flex min-h-11 items-center text-primary underline underline-offset-4 hover:no-underline lg:min-h-8"
                >
                  {{ $t('users.search.clear') }}
                </NuxtLink>
              </p>
            </div>

            <!-- Loading with nothing to show yet: rows of the shape the table will have. -->
            <div v-if="!data" class="flex flex-col gap-2" aria-hidden="true">
              <USkeleton
                v-for="row in 5"
                :key="row"
                role="presentation"
                aria-hidden="true"
                aria-label=""
                class="h-12 w-full"
              />
            </div>

            <!-- No results (workflows §24): the filters matched nothing, and the way back is one link. -->
            <div v-else-if="users.length === 0" class="flex max-w-prose flex-col gap-2 py-6">
              <p class="text-lg font-semibold text-highlighted">{{ $t('users.empty.title') }}</p>
              <p v-if="filtered" class="text-base text-default">
                <NuxtLink
                  :to="locationFor({ role: undefined, search: '' })"
                  class="inline-flex min-h-11 items-center text-primary underline underline-offset-4 hover:no-underline"
                >
                  {{ $t('users.empty.showAll') }}
                </NuxtLink>
              </p>
            </div>

            <div v-else :class="status === 'pending' ? 'opacity-60' : ''">
              <UsersTable
                v-model:selected="selected"
                :users="users"
                :view="view"
                :to="locationFor"
                :signed-in-id="account?.id"
                :selectable="bulkAvailable"
                :role-name="roleName"
              />
            </div>

            <!-- Page links (WordPress' «1 2 3 … Neste»): real links with the page in the address (workflows §7), so a page can be bookmarked
              and the back button works. Only drawn when there is more than one page. -->
            <UPagination
              v-if="data && pageCountOf(data.total, data.perPage) > 1"
              as="nav"
              :aria-label="$t('users.pagination.label')"
              :page="view.page"
              :total="data.total"
              :items-per-page="data.perPage"
              :sibling-count="1"
              show-edges
              :to="(page: number) => locationFor({ page })"
              :ui="{
                list: 'flex-wrap',
                item: PAGE_BUTTON,
                prev: PAGE_BUTTON,
                next: PAGE_BUTTON,
                first: PAGE_BUTTON,
                last: PAGE_BUTTON,
              }"
            />
          </section>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
