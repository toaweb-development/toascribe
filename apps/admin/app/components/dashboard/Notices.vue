<script setup lang="ts">
import type { Notice } from '@toascribe/shared'

// The notices at the top of the dashboard (WordPress' admin notices): what `GET /api/v1/notices` gives, most severe first. Only a
// dismissible notice has «Avvis»; the api keeps the dismissal, so it stays gone after a reload. A notice that could not be dismissed
// stays, and says so. Nothing to show is nothing drawn. (Shown on the dashboard only: a page draws its own panel, so the
// shell cannot put a banner above the page's title; another page can place this component the same way.)
const { t, te } = useI18n()
const adminApi = useAdminApi()

const { data, status, error, refresh } = await useAsyncData('dashboard:notices', () => adminApi.notices())
const notices = computed(() => data.value?.notices ?? [])

const LEVEL: Record<Notice['level'], { color: 'error' | 'warning' | 'success' | 'info'; icon: string }> = {
  error: { color: 'error', icon: 'i-lucide-circle-x' },
  warning: { color: 'warning', icon: 'i-lucide-triangle-alert' },
  success: { color: 'success', icon: 'i-lucide-circle-check' },
  info: { color: 'info', icon: 'i-lucide-info' },
}

const text = (notice: Notice) => noticeText({ t, te }, notice.messageKey, notice.data)
const levelLabel = (notice: Notice) => noticeLevelLabel({ t, te }, notice.level)

const dismissing = ref<string>()
const failures = ref<Record<string, string>>({})
const announcement = ref('')
const heading = useTemplateRef<HTMLElement>('heading')

async function dismiss(notice: Notice) {
  dismissing.value = notice.key
  failures.value = Object.fromEntries(Object.entries(failures.value).filter(([key]) => key !== notice.key))
  try {
    await adminApi.dismissNotice(notice.key)
    data.value = { notices: notices.value.filter((entry) => entry.key !== notice.key) }
    announcement.value = t('dashboard.notices.dismissed')
    // The notice that had focus is gone: focus goes to the heading of the list, never to a removed element.
    await nextTick()
    heading.value?.focus()
  } catch (caught) {
    failures.value = { ...failures.value, [notice.key]: describeApiError(caught, t) }
  } finally {
    dismissing.value = undefined
  }
}
</script>

<template>
  <section aria-labelledby="notices-heading" :aria-busy="status === 'pending'">
    <h2 id="notices-heading" ref="heading" tabindex="-1" class="sr-only outline-none">
      {{ $t('dashboard.notices.heading') }}
    </h2>
    <p role="status" class="sr-only">{{ announcement }}</p>

    <div v-if="status === 'pending' && notices.length === 0" class="h-16" aria-hidden="true">
      <USkeleton role="presentation" aria-hidden="true" aria-label="" class="h-full w-full" />
    </div>

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
        <UButton color="neutral" variant="outline" size="lg" class="min-h-11" @click="() => refresh()">
          {{ $t('dashboard.notices.failed.retry') }}
        </UButton>
      </template>
    </UAlert>

    <ul v-else-if="notices.length > 0" class="flex flex-col gap-3">
      <li v-for="notice in notices" :key="notice.key">
        <UAlert :color="LEVEL[notice.level].color" variant="subtle" :icon="LEVEL[notice.level].icon">
          <template #description>
            <p>
              <span class="sr-only">{{ levelLabel(notice) }}: </span>{{ text(notice) }}
            </p>
            <p v-if="failures[notice.key]" role="alert" class="mt-2 font-medium">
              {{ $t('dashboard.notices.dismissFailed') }} {{ failures[notice.key] }}
            </p>
          </template>
          <template v-if="notice.isDismissible" #actions>
            <UButton
              color="neutral"
              variant="outline"
              size="lg"
              class="min-h-11"
              :loading="dismissing === notice.key"
              :disabled="dismissing !== undefined"
              @click="dismiss(notice)"
            >
              {{ $t('dashboard.notices.dismiss') }}
            </UButton>
          </template>
        </UAlert>
      </li>
    </ul>
  </section>
</template>
