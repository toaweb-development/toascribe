<script setup lang="ts">
// The ten recovery codes, shown once. Copy and print are offered; the person confirms they are saved before going on.
const props = defineProps<{
  codes: readonly string[]
}>()

const saved = defineModel<boolean>('saved', { default: false })

const { t } = useI18n()
const copyNotice = ref<'copied' | 'failed'>()

// The codes take the place of the set-up form: focus goes to their heading so they are read from the top.
const title = useTemplateRef<HTMLElement>('title')
onMounted(() => title.value?.focus())

async function copy() {
  try {
    await navigator.clipboard.writeText(props.codes.join('\n'))
    copyNotice.value = 'copied'
  } catch {
    // No clipboard (plain http, or refused): the codes are on screen to select by hand.
    copyNotice.value = 'failed'
  }
}

function print() {
  window.print()
}
</script>

<template>
  <section class="flex flex-col gap-4" aria-labelledby="recovery-codes-title">
    <h2 id="recovery-codes-title" ref="title" tabindex="-1" class="text-lg font-semibold text-highlighted outline-none">
      {{ $t('auth.recovery.title') }}
    </h2>
    <p class="text-base text-default">{{ $t('auth.recovery.intro') }}</p>

    <ul
      class="grid grid-cols-1 gap-2 rounded-md bg-muted p-4 font-mono text-base text-highlighted"
      :aria-label="$t('auth.recovery.listLabel')"
    >
      <li v-for="code in codes" :key="code">{{ code }}</li>
    </ul>

    <div class="flex flex-wrap gap-2 print:hidden">
      <UButton color="neutral" variant="outline" size="lg" class="min-h-11" @click="copy">{{
        $t('auth.recovery.copy')
      }}</UButton>
      <UButton color="neutral" variant="outline" size="lg" class="min-h-11" @click="print">{{
        $t('auth.recovery.print')
      }}</UButton>
    </div>
    <p v-if="copyNotice" role="status" class="text-sm text-toned print:hidden">
      {{ copyNotice === 'copied' ? $t('auth.recovery.copied') : $t('auth.recovery.copyFailed') }}
    </p>

    <UCheckbox v-model="saved" size="lg" :label="t('auth.recovery.saved')" class="print:hidden" />
  </section>
</template>
