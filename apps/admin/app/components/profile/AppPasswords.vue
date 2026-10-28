<script setup lang="ts">
import type { AppPasswordItem } from '@toascribe/shared'

// «Applikasjonspassord» (K-016; WordPress' profile section): a name for each client, the password shown once when it is made (with
// «Kopier»), and for each one when it was made, last used and from where, with «Tilbakekall». They work against the API with
// `Authorization: Basic` over HTTPS, never for signing in here.
const { t, locale } = useI18n()
const meApi = useMeApi()
const confirm = useConfirmDialog()

const { data, status, refresh, error } = useLazyAsyncData('profile:app-passwords', () => meApi.appPasswords(), {
  server: false,
})
const items = computed(() => data.value?.items ?? [])

const name = ref('')
const making = ref(false)
const made = ref<{ name: string; password: string }>()
const copied = ref<'copied' | 'failed'>()
const working = ref<string>()
const message = ref('')
const failure = ref<string>()

async function create(): Promise<void> {
  if (making.value || name.value.trim() === '') return
  failure.value = undefined
  message.value = ''
  copied.value = undefined
  making.value = true
  try {
    const result = await meApi.createAppPassword(name.value.trim())
    made.value = { name: result.item.name, password: result.password }
    name.value = ''
    await refresh()
  } catch (caught) {
    const code = caught instanceof ApiRequestError ? caught.code : undefined
    failure.value = code === 'name_taken' ? t('profile.appPasswords.nameTaken') : describeApiError(caught, t)
  } finally {
    making.value = false
  }
}

async function copy(): Promise<void> {
  if (!made.value) return
  try {
    await navigator.clipboard.writeText(made.value.password)
    copied.value = 'copied'
  } catch {
    copied.value = 'failed'
  }
}

async function revoke(item: AppPasswordItem): Promise<void> {
  message.value = ''
  failure.value = undefined
  const yes = await confirm.ask({
    title: t('profile.appPasswords.revokeTitle', { name: item.name }),
    description: t('profile.appPasswords.revokeText'),
    confirmLabel: t('profile.appPasswords.revoke'),
    cancelLabel: t('profile.cancel'),
    color: 'error',
  })
  if (!yes) return
  working.value = item.id
  try {
    await meApi.revokeAppPassword(item.id)
    message.value = t('profile.appPasswords.revoked', { name: item.name })
    if (made.value?.name === item.name) made.value = undefined
    await refresh()
    await focusSectionHeading('app-passwords')
  } catch (caught) {
    failure.value = describeApiError(caught, t)
  } finally {
    working.value = undefined
  }
}
</script>

<template>
  <ProfileSection id="app-passwords" :title="$t('profile.appPasswords.title')" :level="3">
    <div class="flex flex-col gap-4" :aria-busy="status === 'pending'">
      <p class="max-w-prose text-base text-default">{{ $t('profile.appPasswords.help') }}</p>

      <form class="flex flex-wrap items-end gap-3" @submit.prevent="create">
        <UFormField :label="$t('profile.appPasswords.name')" name="app-password-name" class="min-w-0">
          <UInput v-model="name" size="xl" maxlength="100" class="w-full sm:w-72" />
        </UFormField>
        <UButton type="submit" size="lg" class="min-h-11" :loading="making" :aria-disabled="name.trim() === ''">
          {{ $t('profile.appPasswords.add') }}
        </UButton>
      </form>

      <div v-if="made" class="flex flex-col gap-3 rounded-md border border-default p-4" data-testid="app-password-made">
        <p class="font-medium text-highlighted">{{ $t('profile.appPasswords.madeTitle', { name: made.name }) }}</p>
        <p class="text-base text-default">{{ $t('profile.appPasswords.madeOnce') }}</p>
        <p class="rounded-md bg-muted p-3 font-mono text-lg tracking-wide break-words text-highlighted select-all">
          {{ made.password }}
        </p>
        <div class="flex flex-wrap items-center gap-3">
          <UButton color="neutral" variant="outline" size="lg" class="min-h-11" @click="copy">
            {{ $t('profile.appPasswords.copy') }}
          </UButton>
          <p role="status" class="text-sm text-toned">
            <template v-if="copied === 'copied'">{{ $t('profile.appPasswords.copied') }}</template>
            <template v-else-if="copied === 'failed'">{{ $t('profile.appPasswords.copyFailed') }}</template>
          </p>
        </div>
      </div>

      <UAlert
        v-if="error && !data"
        color="error"
        variant="subtle"
        role="alert"
        :title="$t('profile.appPasswords.loadFailed')"
      >
        <template #actions>
          <UButton color="neutral" variant="outline" size="lg" class="min-h-11" @click="() => refresh()">
            {{ $t('profile.retry') }}
          </UButton>
        </template>
      </UAlert>
      <p v-else-if="data && items.length === 0" class="text-sm text-toned">{{ $t('profile.appPasswords.none') }}</p>
      <ul
        v-else-if="items.length > 0"
        class="flex flex-col divide-y divide-default rounded-md border border-default"
        :aria-label="$t('profile.appPasswords.listLabel')"
      >
        <li v-for="item in items" :key="item.id" class="flex flex-wrap items-center justify-between gap-3 p-3">
          <div class="min-w-0">
            <p class="font-medium break-words text-highlighted">{{ item.name }}</p>
            <p class="text-sm text-toned">
              {{ $t('profile.appPasswords.created', { when: formatWhen(item.createdAt, locale) }) }}
            </p>
            <p class="text-sm text-toned">
              {{
                item.lastUsedAt
                  ? $t('profile.appPasswords.lastUsed', { when: formatWhen(item.lastUsedAt, locale) })
                  : $t('profile.appPasswords.neverUsed')
              }}
              <span v-if="item.lastUsedIp"> · {{ $t('profile.sessions.ip', { ip: item.lastUsedIp }) }}</span>
            </p>
          </div>
          <UButton
            color="neutral"
            variant="outline"
            size="lg"
            class="min-h-11"
            :loading="working === item.id"
            :aria-label="$t('profile.appPasswords.revokeLabel', { name: item.name })"
            @click="revoke(item)"
          >
            {{ $t('profile.appPasswords.revoke') }}
          </UButton>
        </li>
      </ul>

      <p role="status" class="text-sm text-default">{{ message }}</p>
      <UAlert v-if="failure" color="error" variant="subtle" role="alert" :title="failure" />
    </div>
  </ProfileSection>
</template>
