<script setup lang="ts">
// «Tofaktorautentisering»: whether it is on, the authenticator apps, setting one up, new recovery codes and removing an app. Every
// change that proves the owner asks for the password in the shared dialog (useReauth). It loads and fails by itself, so the rest of
// the page works when this part cannot load.
const { t, locale } = useI18n()
const meApi = useMeApi()
const reauth = useReauth()

// Asked in the browser only: the dates are shown in the person's own time zone.
const { data, status, refresh, error } = useLazyAsyncData('profile:mfa', () => meApi.mfa(), { server: false })

const mode = ref<'list' | 'enrol' | 'codes'>('list')
const codes = ref<readonly string[]>([])
const codesSaved = ref(false)
const message = ref('')
const failure = ref<string>()

/** The most apps the API accepts (MAX_FACTORS in the api). Past it the button would only meet a refusal. */
const MAX_APPS = 5

const factors = computed(() => data.value?.factors ?? [])
const required = computed(() => data.value?.required === true)

function nameOf(factor: { name: string | null }): string {
  return factor.name ?? t('profile.mfa.unnamed')
}

const focusHeading = () => focusSectionHeading('two-factor')

function beginEnrol() {
  message.value = ''
  failure.value = undefined
  mode.value = 'enrol'
}

async function enrolled() {
  mode.value = 'list'
  message.value = t('profile.mfa.appAdded')
  await refresh()
  await focusHeading()
}

async function cancelEnrol() {
  mode.value = 'list'
  await focusHeading()
}

async function newCodes() {
  message.value = ''
  failure.value = undefined
  let fresh: readonly string[] = []
  const outcome = await reauth.ask({
    title: t('profile.mfa.codesTitle'),
    description: t('profile.mfa.codesText'),
    confirmLabel: t('profile.mfa.codesButton'),
    action: async (password) => {
      fresh = (await meApi.newRecoveryCodes(password)).recoveryCodes
    },
  })
  if (outcome.status === 'done') {
    codes.value = fresh
    codesSaved.value = false
    mode.value = 'codes'
    await refresh()
  } else if (outcome.status === 'failed') {
    failure.value = describeApiError(outcome.error, t)
  }
}

async function codesDone() {
  mode.value = 'list'
  codes.value = []
  message.value = t('profile.mfa.codesKept')
  await focusHeading()
}

async function remove(factor: { id: string; name: string | null }) {
  message.value = ''
  failure.value = undefined
  const last = factors.value.length === 1
  const outcome = await reauth.ask({
    title: t('profile.mfa.removeTitle', { name: nameOf(factor) }),
    description: last ? t('profile.mfa.removeLastText') : t('profile.mfa.removeText'),
    confirmLabel: t('profile.mfa.removeButton'),
    color: 'error',
    action: (password) => meApi.removeFactor(factor.id, password),
  })
  if (outcome.status === 'done') {
    message.value = t('profile.mfa.removed', { name: nameOf(factor) })
    await refresh()
    // The row with the button is gone: focus goes to the heading of the section.
    await focusHeading()
  } else if (outcome.status === 'failed') {
    failure.value = describeApiError(outcome.error, t)
  }
}
</script>

<template>
  <ProfileSection id="two-factor" :title="$t('profile.mfa.title')" :level="3">
    <div class="flex flex-col gap-4" :aria-busy="status === 'pending'">
      <div v-if="status === 'idle' || status === 'pending'" class="flex flex-col gap-3">
        <USkeleton class="h-6 w-2/3" />
        <USkeleton class="h-11 w-48" />
      </div>

      <UAlert
        v-else-if="error || !data"
        color="error"
        variant="subtle"
        role="alert"
        :title="$t('profile.mfa.loadFailed.title')"
        :description="$t('profile.mfa.loadFailed.text')"
      >
        <template #actions>
          <UButton color="neutral" variant="outline" size="lg" class="min-h-11" @click="() => refresh()">
            {{ $t('profile.retry') }}
          </UButton>
        </template>
      </UAlert>

      <template v-else-if="mode === 'enrol'">
        <AuthMfaEnrol profile @finished="enrolled" @cancel="cancelEnrol" @expired="enrolled" />
      </template>

      <template v-else-if="mode === 'codes'">
        <AuthRecoveryCodes v-model:saved="codesSaved" :codes="codes" />
        <div>
          <UButton
            size="lg"
            class="min-h-11"
            :class="{ 'opacity-60': !codesSaved }"
            :aria-disabled="!codesSaved"
            :aria-describedby="codesSaved ? undefined : 'codes-hint'"
            @click="codesSaved ? codesDone() : undefined"
          >
            {{ $t('profile.mfa.codesDone') }}
          </UButton>
        </div>
        <p v-if="!codesSaved" id="codes-hint" class="text-sm text-toned">{{ $t('auth.enrol.finishHint') }}</p>
      </template>

      <template v-else>
        <p class="text-base text-default">
          <strong class="font-semibold text-highlighted">
            {{ factors.length > 0 ? $t('profile.mfa.on', factors.length) : $t('profile.mfa.off') }}
          </strong>
          {{ ' ' }}{{ $t('profile.mfa.intro') }}
        </p>
        <p v-if="required" class="text-base text-default">{{ $t('profile.mfa.required') }}</p>

        <ul v-if="factors.length" class="flex flex-col divide-y divide-default rounded-md border border-default">
          <li v-for="factor in factors" :key="factor.id" class="flex flex-wrap items-center justify-between gap-3 p-3">
            <div class="min-w-0">
              <p class="font-medium break-words text-highlighted">{{ nameOf(factor) }}</p>
              <p class="text-sm text-toned">
                {{ $t('profile.mfa.createdAt', { when: formatWhen(factor.createdAt, locale) }) }}
                ·
                {{
                  factor.lastUsedAt
                    ? $t('profile.mfa.lastUsed', { when: formatWhen(factor.lastUsedAt, locale) })
                    : $t('profile.mfa.neverUsed')
                }}
              </p>
            </div>
            <UButton
              v-if="!(required && factors.length === 1)"
              color="error"
              variant="outline"
              size="lg"
              class="min-h-11"
              :aria-label="$t('profile.mfa.removeLabel', { name: nameOf(factor) })"
              @click="remove(factor)"
            >
              {{ $t('profile.mfa.remove') }}
            </UButton>
          </li>
        </ul>
        <p v-if="factors.length" class="text-sm text-toned">
          {{ $t('profile.mfa.codesLeft', data.recoveryCodesRemaining) }}
        </p>

        <p v-if="failure" role="alert" class="font-medium text-error">{{ failure }}</p>

        <div class="flex flex-wrap gap-2">
          <UButton
            v-if="factors.length < MAX_APPS"
            color="neutral"
            variant="outline"
            size="lg"
            class="min-h-11"
            @click="beginEnrol"
          >
            {{ $t('profile.mfa.setUp') }}
          </UButton>
          <UButton v-if="factors.length" color="neutral" variant="outline" size="lg" class="min-h-11" @click="newCodes">
            {{ $t('profile.mfa.newCodes') }}
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
