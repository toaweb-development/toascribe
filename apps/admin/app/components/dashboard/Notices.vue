<script setup lang="ts">
import type { Notice } from '@toascribe/shared'

// The notices at the top of the dashboard (WordPress' admin notices), in one box as «Blekk» draws them (M2.1): one row each, with
// one action. What `GET /api/v1/notices` gives comes first, most severe first; the welcome comes last («Velkommen til toascribe!»,
// WordPress' welcome panel, kept in the account's `dismissedWelcome`). «Avvis» hides a notice for this account only (the api keeps
// it in the account's preferences, and the welcome in `dismissedWelcome`), so it stays gone after a reload and on other devices.
// A notice that cannot be dismissed has a link that says how to fix it, where the documentation has one. Nothing to show is
// nothing drawn.
const { t, te } = useI18n()
const adminApi = useAdminApi()
const auth = useAuth()
const config = useRuntimeConfig()
const { preferences, update } = useAdminPreferences()

const { data, status, error, refresh } = await useAsyncData('dashboard:notices', () => adminApi.notices())
const notices = computed(() => data.value?.notices ?? [])
const welcome = computed(() => preferences.value !== undefined && !preferences.value.dismissedWelcome)
const canListUsers = computed(
  () => auth.session.value.status === 'authenticated' && auth.session.value.account.capabilities.includes('list_users'),
)
const warns = computed(() => notices.value.some((notice) => notice.level === 'warning' || notice.level === 'error'))

const LEVEL: Record<Notice['level'], { icon: string; tone: string }> = {
  error: { icon: 'i-lucide-circle-x', tone: 'text-danger' },
  warning: { icon: 'i-lucide-triangle-alert', tone: 'text-warning-text' },
  success: { icon: 'i-lucide-circle-check', tone: 'text-success-text' },
  info: { icon: 'i-lucide-info', tone: 'text-accent-text' },
}

/** The documentation page that says how to fix a notice that cannot be dismissed. */
const FIX_PAGES: Readonly<Record<string, string>> = {
  'notices.emailNotVerified': 'installasjon',
  'notices.proxyNotTrusted': 'installasjon',
}
const fixUrl = (notice: Notice) => {
  const page = FIX_PAGES[notice.messageKey]
  return page === undefined ? undefined : docsUrl(page, config.public.version)
}

const text = (notice: Notice) => noticeText({ t, te }, notice.messageKey, notice.data)
const levelLabel = (notice: Notice) => noticeLevelLabel({ t, te }, notice.level)

const WELCOME = 'welcome'
const dismissing = ref<string>()
const failures = ref<Record<string, string>>({})
const announcement = ref('')
const heading = useTemplateRef<HTMLElement>('heading')

async function dismiss(key: string) {
  dismissing.value = key
  failures.value = Object.fromEntries(Object.entries(failures.value).filter(([entry]) => entry !== key))
  try {
    if (key === WELCOME) {
      await update({ dismissedWelcome: true })
    } else {
      await adminApi.dismissNotice(key)
      data.value = { notices: notices.value.filter((entry) => entry.key !== key) }
    }
    announcement.value = t('dashboard.notices.dismissed')
    // The row that had focus is gone: focus goes to the heading of the list, never to a removed element.
    await nextTick()
    heading.value?.focus()
  } catch (caught) {
    failures.value = { ...failures.value, [key]: describeApiError(caught, t) }
  } finally {
    dismissing.value = undefined
  }
}

const action = 'inline-flex min-h-control shrink-0 items-center rounded-field px-2 font-medium hover:underline'
</script>

<template>
  <section aria-labelledby="notices-heading" :aria-busy="status === 'pending'">
    <h2 id="notices-heading" ref="heading" tabindex="-1" class="sr-only outline-none">
      {{ $t('dashboard.notices.heading') }}
    </h2>
    <p role="status" class="sr-only">{{ announcement }}</p>

    <USkeleton
      v-if="status === 'pending' && notices.length === 0"
      role="presentation"
      aria-hidden="true"
      aria-label=""
      class="h-14 w-full rounded-card"
    />

    <UAlert
      v-else-if="error && notices.length === 0"
      color="error"
      variant="subtle"
      role="alert"
      :title="$t('dashboard.notices.failed.title')"
    >
      <template #description>
        <p>{{ $t('dashboard.notices.failed.text') }}</p>
      </template>
      <template #actions>
        <UButton color="neutral" variant="outline" size="lg" class="min-h-control" @click="() => refresh()">
          {{ $t('dashboard.notices.failed.retry') }}
        </UButton>
      </template>
    </UAlert>

    <ul
      v-if="notices.length > 0 || welcome"
      class="flex flex-col divide-y overflow-hidden rounded-card border"
      :class="warns ? 'divide-warning-line border-warning-line bg-warning-soft' : 'divide-line border-line bg-surface'"
    >
      <li
        v-for="notice in notices"
        :key="notice.key"
        class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5"
      >
        <div class="flex min-w-0 items-start gap-3">
          <UIcon
            :name="LEVEL[notice.level].icon"
            class="mt-0.5 size-4 shrink-0"
            :class="LEVEL[notice.level].tone"
            aria-hidden="true"
          />
          <div class="min-w-0">
            <p class="text-body text-heading">
              <span class="sr-only">{{ levelLabel(notice) }}: </span>{{ text(notice) }}
            </p>
            <p v-if="failures[notice.key]" role="alert" class="mt-1 font-medium text-danger">
              {{ $t('dashboard.notices.dismissFailed') }} {{ failures[notice.key] }}
            </p>
          </div>
        </div>
        <button
          v-if="notice.isDismissible"
          type="button"
          :class="[action, warns ? 'text-warning-text' : 'text-accent-text']"
          :disabled="dismissing !== undefined"
          @click="dismiss(notice.key)"
        >
          {{ $t('dashboard.notices.dismiss') }}
        </button>
        <ULink
          v-else-if="fixUrl(notice)"
          :to="fixUrl(notice)"
          target="_blank"
          rel="noopener noreferrer"
          :class="[action, warns ? 'text-warning-text' : 'text-accent-text']"
        >
          {{ $t('dashboard.notices.fix') }}<span class="sr-only"> {{ $t('shell.newTab') }}</span>
        </ULink>
      </li>

      <li
        v-if="welcome"
        class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5"
      >
        <div class="flex min-w-0 items-start gap-3">
          <UIcon name="i-lucide-info" class="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden="true" />
          <div class="min-w-0">
            <i18n-t v-if="canListUsers" keypath="dashboard.welcome.withUsers" tag="p" class="text-body text-heading">
              <template #profile>
                <ULink to="/profile" class="text-accent-text underline underline-offset-4">
                  {{ $t('dashboard.welcome.profile') }}
                </ULink>
              </template>
              <template #users>
                <ULink to="/users" class="text-accent-text underline underline-offset-4">
                  {{ $t('dashboard.welcome.users') }}
                </ULink>
              </template>
            </i18n-t>
            <i18n-t v-else keypath="dashboard.welcome.text" tag="p" class="text-body text-heading">
              <template #profile>
                <ULink to="/profile" class="text-accent-text underline underline-offset-4">
                  {{ $t('dashboard.welcome.profile') }}
                </ULink>
              </template>
            </i18n-t>
            <p v-if="failures[WELCOME]" role="alert" class="mt-1 font-medium text-danger">
              {{ $t('dashboard.welcome.dismissFailed') }} {{ failures[WELCOME] }}
            </p>
          </div>
        </div>
        <button
          type="button"
          :class="[action, warns ? 'text-warning-text' : 'text-accent-text']"
          :aria-label="$t('dashboard.welcome.dismissLabel')"
          :disabled="dismissing !== undefined"
          @click="dismiss(WELCOME)"
        >
          {{ $t('dashboard.welcome.dismiss') }}
        </button>
      </li>
    </ul>
  </section>
</template>
