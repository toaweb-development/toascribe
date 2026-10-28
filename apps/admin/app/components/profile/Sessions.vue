<script setup lang="ts">
import type { SessionListItem } from '@toascribe/shared'

// «Økter»: the sessions that are signed in to the account (device, address, when), «Logg ut» for each of the others and «Logg ut
// overalt ellers». The list loads in the browser (it shows times in the person's own time zone) and fails by itself.
const { t, locale } = useI18n()
const meApi = useMeApi()
const confirm = useConfirmDialog()

const { data, status, refresh, error } = useLazyAsyncData('profile:sessions', () => meApi.sessions(), { server: false })

// This session first, then the others as the API lists them (newest first).
const sessions = computed(() =>
  [...(data.value?.sessions ?? [])].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent)),
)
const others = computed(() => sessions.value.filter((session) => !session.isCurrent))
const working = ref<string>()
const message = ref('')
const failure = ref<string>()

function deviceOf(session: SessionListItem): string {
  const { browser, system } = describeDevice(session.userAgent)
  if (browser && system) {
    return t('profile.sessions.deviceBoth', { browser, system })
  }
  return browser ?? system ?? t('profile.sessions.deviceUnknown')
}

async function endOne(session: SessionListItem) {
  message.value = ''
  failure.value = undefined
  const device = deviceOf(session)
  const yes = await confirm.ask({
    title: t('profile.sessions.endTitle', { device }),
    description: t('profile.sessions.endText'),
    confirmLabel: t('profile.sessions.end'),
    cancelLabel: t('profile.cancel'),
    color: 'error',
  })
  if (!yes) {
    return
  }
  working.value = session.id
  try {
    await meApi.endSession(session.id)
    message.value = t('profile.sessions.ended', { device })
    await refresh()
    // The row with the button is gone: focus goes to the heading of the section.
    await focusSectionHeading('sessions')
  } catch (caught) {
    failure.value = describeApiError(caught, t)
  } finally {
    working.value = undefined
  }
}

async function endOthers() {
  message.value = ''
  failure.value = undefined
  const yes = await confirm.ask({
    title: t('profile.sessions.endOthersTitle'),
    description: t('profile.sessions.endOthersText', others.value.length),
    confirmLabel: t('profile.sessions.endOthers'),
    cancelLabel: t('profile.cancel'),
    color: 'error',
  })
  if (!yes) {
    return
  }
  working.value = 'others'
  try {
    const { revoked } = await meApi.endOtherSessions()
    message.value = t('profile.sessions.endedOthers', revoked)
    await refresh()
    await focusSectionHeading('sessions')
  } catch (caught) {
    failure.value = describeApiError(caught, t)
  } finally {
    working.value = undefined
  }
}
</script>

<template>
  <ProfileSection id="sessions" :title="$t('profile.sessions.title')" :level="3">
    <div class="flex flex-col gap-4" :aria-busy="status === 'pending'">
      <div v-if="status === 'idle' || (status === 'pending' && !data)" class="flex flex-col gap-3">
        <USkeleton class="h-16 w-full" />
        <USkeleton class="h-11 w-48" />
      </div>

      <UAlert
        v-else-if="error && !data"
        color="error"
        variant="subtle"
        role="alert"
        :title="$t('profile.sessions.loadFailed.title')"
        :description="$t('profile.sessions.loadFailed.text')"
      >
        <template #actions>
          <UButton color="neutral" variant="outline" size="lg" class="min-h-11" @click="() => refresh()">
            {{ $t('profile.retry') }}
          </UButton>
        </template>
      </UAlert>

      <template v-else>
        <p class="text-base text-default">
          {{ others.length ? $t('profile.sessions.help') : $t('profile.sessions.onlyThis') }}
        </p>

        <ul
          class="flex flex-col divide-y divide-default rounded-md border border-default"
          :aria-label="$t('profile.sessions.listLabel')"
        >
          <li
            v-for="session in sessions"
            :key="session.id"
            class="flex flex-wrap items-center justify-between gap-3 p-3"
          >
            <div class="min-w-0">
              <p class="flex flex-wrap items-center gap-2 font-medium text-highlighted">
                <span class="break-words">{{ deviceOf(session) }}</span>
                <UBadge v-if="session.isCurrent" color="primary" variant="subtle" size="md">
                  {{ $t('profile.sessions.current') }}
                </UBadge>
              </p>
              <p class="text-sm text-toned">
                <span v-if="session.ip">{{ $t('profile.sessions.ip', { ip: session.ip }) }} · </span>
                {{ $t('profile.sessions.lastSeen', { when: formatWhen(session.lastSeenAt, locale) }) }}
              </p>
              <p class="text-sm text-toned">
                {{ $t('profile.sessions.signedIn', { when: formatWhen(session.createdAt, locale) }) }}
              </p>
            </div>
            <UButton
              v-if="!session.isCurrent"
              color="neutral"
              variant="outline"
              size="lg"
              class="min-h-11"
              :loading="working === session.id"
              :aria-label="$t('profile.sessions.endLabel', { device: deviceOf(session) })"
              @click="endOne(session)"
            >
              {{ $t('profile.sessions.end') }}
            </UButton>
          </li>
        </ul>

        <p v-if="failure" role="alert" class="font-medium text-error">{{ failure }}</p>

        <div v-if="others.length">
          <UButton
            color="neutral"
            variant="outline"
            size="lg"
            class="min-h-11"
            :loading="working === 'others'"
            @click="endOthers"
          >
            {{ $t('profile.sessions.endOthers') }}
          </UButton>
        </div>
      </template>

      <!-- The region stays in the page, empty, so the text put into it is announced. -->
      <div role="status" class="min-h-6 text-sm text-default">
        <span v-if="message" class="inline-flex items-start gap-1.5">
          <UIcon name="i-lucide-check" class="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          <span>{{ message }}</span>
        </span>
      </div>
    </div>
  </ProfileSection>
</template>
