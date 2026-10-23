<script setup lang="ts">
// The recovery key (step 5): shown once, with «Kopier» and «Last ned som tekstfil», and a box the person ticks to say it is
// saved. The api keeps only a check value of it, so a key that is lost cannot be made again; the wizard says so.
//
// The download is a Blob address on an `<a download>` that the click makes and removes. The admin's CSP has no `blob:` entry
// and needs none: a download is not a script, style or connection, and no directive governs it (checked in Chromium by the
// end-to-end test of the wizard, which saves the file).
const props = defineProps<{
  recoveryKey: string
  /** The site's title, for the file. */
  siteTitle: string
}>()

const saved = defineModel<boolean>('saved', { default: false })

const { t, locale } = useI18n()
const notice = ref<'copied' | 'failed' | 'downloaded'>()

// A new key replaces the form under the person's hands: focus goes to its heading so it is read from the top.
const title = useTemplateRef<HTMLElement>('title')
onMounted(() => title.value?.focus())

const FILE_NAME = 'toascribe-recovery-key.txt'

function fileText(): string {
  const date = new Intl.DateTimeFormat(locale.value, { dateStyle: 'long' }).format(new Date())
  return t('setup.key.file', { site: props.siteTitle, date, key: props.recoveryKey })
}

async function copy() {
  try {
    await navigator.clipboard.writeText(props.recoveryKey)
    notice.value = 'copied'
  } catch {
    // No clipboard (plain http on a LAN address, or refused): the key is on screen to select by hand.
    notice.value = 'failed'
  }
}

function download() {
  const url = URL.createObjectURL(new Blob([fileText()], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = FILE_NAME
  document.body.append(link)
  link.click()
  link.remove()
  // The browser has the file once the click is handled; the address is freed a moment later, not in the same tick.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  notice.value = 'downloaded'
}
</script>

<template>
  <section class="flex flex-col gap-4" aria-labelledby="recovery-key-title">
    <h3 id="recovery-key-title" ref="title" tabindex="-1" class="text-lg font-semibold text-highlighted outline-none">
      {{ $t('setup.key.title') }}
    </h3>
    <p class="text-base text-default">{{ $t('setup.key.intro') }}</p>
    <p class="text-base font-semibold text-default">{{ $t('setup.key.once') }}</p>

    <p
      class="rounded-md bg-muted p-4 font-mono text-lg tracking-wide break-words text-highlighted select-all"
      data-testid="recovery-key"
    >
      {{ recoveryKey }}
    </p>

    <div class="flex flex-wrap gap-2 print:hidden">
      <UButton color="neutral" variant="outline" size="xl" class="min-h-11" @click="copy">{{
        $t('setup.key.copy')
      }}</UButton>
      <UButton color="neutral" variant="outline" size="xl" class="min-h-11" @click="download">{{
        $t('setup.key.download')
      }}</UButton>
    </div>
    <p role="status" class="text-sm text-toned print:hidden">
      <template v-if="notice === 'copied'">{{ $t('setup.key.copied') }}</template>
      <template v-else-if="notice === 'failed'">{{ $t('setup.key.copyFailed') }}</template>
      <template v-else-if="notice === 'downloaded'">{{ $t('setup.key.downloaded') }}</template>
    </p>

    <UCheckbox v-model="saved" size="lg" :label="$t('setup.key.saved')" />
  </section>
</template>
