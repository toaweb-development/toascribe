<script setup lang="ts">
import type { SetupCheckResponse } from '@toascribe/shared'

// Step 2: the system check. Every line says what was looked at, whether it is in order and, if not, what to do. The check
// reads the api's own view (database, migrations, the two keys, the proxy) and compares `PUBLIC_ORIGIN` with the address this
// browser used. What does not pass blocks the install, except the proxy, which only warns.
const props = defineProps<{
  token: string
}>()

const emit = defineEmits<{ installed: []; lost: [message: string]; next: []; back: [] }>()

const { t } = useI18n()
const setupApi = useSetupApi()
const { pending, error, failures, run } = useSetupRequest((lost) => {
  if (lost.kind === 'installed') {
    emit('installed')
  } else {
    emit('lost', lost.message)
  }
})

const check = ref<SetupCheckResponse>()

async function load() {
  check.value = undefined
  check.value = await run(() => setupApi.check(props.token))
}

onMounted(load)

type Level = 'ok' | 'problem' | 'warning' | 'info'
interface Row {
  id: string
  level: Level
  title: string
  text: string
}

// The proxy check never blocks: it is advice about the set-up around the stack.
function proxyRow(proxy: SetupCheckResponse['proxy']): Row {
  const title = t('setup.check.proxy.title')
  switch (proxy.state) {
    case 'configured':
      return { id: 'proxy', level: 'ok', title, text: t('setup.check.proxy.configured') }
    case 'ok':
      return { id: 'proxy', level: 'ok', title, text: t('setup.check.proxy.ok') }
    case 'warning':
      return {
        id: 'proxy',
        level: 'warning',
        title,
        text: t('setup.check.proxy.warning', { address: proxy.address ?? '?' }),
      }
    default:
      return { id: 'proxy', level: 'info', title, text: t('setup.check.proxy.watching', { n: proxy.observed }) }
  }
}

function originRow(origin: SetupCheckResponse['origin']): Row {
  const title = t('setup.check.origin.title')
  if (!origin.ok) {
    return {
      id: 'origin',
      level: 'problem',
      title,
      text: t('setup.check.origin.mismatch', { observed: origin.observed ?? '?', configured: origin.configured }),
    }
  }
  if (origin.observed === null) {
    return {
      id: 'origin',
      level: 'info',
      title,
      text: t('setup.check.origin.unknown', { configured: origin.configured }),
    }
  }
  return { id: 'origin', level: 'ok', title, text: t('setup.check.origin.ok', { origin: origin.observed }) }
}

const rows = computed<Row[]>(() => {
  const result = check.value
  if (result === undefined) {
    return []
  }
  const { database, migrations, encryptionKey, signingKey } = result
  return [
    {
      id: 'database',
      level: database.ok ? 'ok' : 'problem',
      title: t('setup.check.database.title'),
      text: database.ok ? t('setup.check.database.ok') : t('setup.check.database.problem'),
    },
    {
      id: 'migrations',
      level: migrations.ok ? 'ok' : 'problem',
      title: t('setup.check.migrations.title'),
      text: migrations.ok
        ? t('setup.check.migrations.ok', { applied: migrations.applied, expected: migrations.expected })
        : t('setup.check.migrations.problem', { applied: migrations.applied, expected: migrations.expected }),
    },
    {
      id: 'encryption',
      level: encryptionKey.ok ? 'ok' : 'problem',
      title: t('setup.check.encryption.title'),
      text: encryptionKey.ok
        ? t('setup.check.encryption.ok', { version: encryptionKey.version })
        : t('setup.check.encryption.problem'),
    },
    {
      id: 'signing',
      level: signingKey.ok ? 'ok' : 'problem',
      title: t('setup.check.signing.title'),
      text: signingKey.ok ? t('setup.check.signing.ok') : t('setup.check.signing.problem'),
    },
    originRow(result.origin),
    proxyRow(result.proxy),
  ]
})

const problems = computed(() => rows.value.filter((row) => row.level === 'problem').length)
const passed = computed(() => check.value?.ok === true)

const announcement = computed(() => {
  if (pending.value) {
    return t('setup.check.working')
  }
  if (check.value === undefined) {
    return ''
  }
  return passed.value ? t('setup.check.passed') : t('setup.check.failed', { n: problems.value })
})

const ICONS: Record<Level, string> = {
  ok: 'i-lucide-circle-check',
  problem: 'i-lucide-circle-x',
  warning: 'i-lucide-triangle-alert',
  info: 'i-lucide-info',
}
const ICON_COLOURS: Record<Level, string> = {
  ok: 'text-success',
  problem: 'text-error',
  warning: 'text-warning',
  info: 'text-info',
}

function next() {
  if (passed.value) {
    emit('next')
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <p class="text-base text-default">{{ $t('setup.check.intro') }}</p>

    <p role="status" class="text-sm text-toned">{{ announcement }}</p>

    <AuthMessage v-if="error" :key="failures" kind="error" focus>{{ error }}</AuthMessage>

    <ul v-if="rows.length > 0" class="flex flex-col divide-y divide-default rounded-md border border-default">
      <li v-for="row in rows" :key="row.id" class="flex gap-3 p-4">
        <UIcon
          :name="ICONS[row.level]"
          :class="ICON_COLOURS[row.level]"
          class="mt-0.5 size-5 shrink-0"
          aria-hidden="true"
        />
        <div class="min-w-0 flex-1">
          <p class="text-base font-semibold text-highlighted">
            {{ row.title }}
            <span class="ml-1 text-sm font-normal text-toned">
              <template v-if="row.level === 'ok'">{{ $t('setup.check.level.ok') }}</template>
              <template v-else-if="row.level === 'problem'">{{ $t('setup.check.level.problem') }}</template>
              <template v-else-if="row.level === 'warning'">{{ $t('setup.check.level.warning') }}</template>
              <template v-else>{{ $t('setup.check.level.info') }}</template>
            </span>
          </p>
          <p class="mt-1 text-base break-words text-default">{{ row.text }}</p>
        </div>
      </li>
    </ul>

    <p v-if="check && !passed" id="check-blocked" class="text-base text-default">{{ $t('setup.check.blocked') }}</p>

    <div class="flex flex-wrap gap-2">
      <UButton color="neutral" variant="outline" size="xl" class="min-h-11" @click="emit('back')">{{
        $t('setup.nav.back')
      }}</UButton>
      <UButton color="neutral" variant="outline" size="xl" class="min-h-11" :loading="pending" @click="load">{{
        $t('setup.check.again')
      }}</UButton>
      <UButton
        size="xl"
        class="min-h-11"
        :aria-disabled="!passed"
        :aria-describedby="check && !passed ? 'check-blocked' : undefined"
        @click="next"
        >{{ $t('setup.nav.next') }}</UButton
      >
    </div>
  </div>
</template>
