<script setup lang="ts">
import { passwordStrength } from '@toascribe/shared'

// An indication, not a gate: the API only demands eight characters (NIST SP 800-63B). The level is a word as well as a
// colour, and the word is announced when it changes.
const props = defineProps<{
  password: string
}>()

const strength = computed(() => passwordStrength(props.password))

const SEGMENT_COLOURS = ['bg-error', 'bg-error', 'bg-warning', 'bg-success', 'bg-success'] as const
const filled = computed(() => (props.password === '' ? 0 : Math.max(1, strength.value)))
</script>

<template>
  <div v-if="password !== ''" class="flex flex-col gap-1">
    <div class="grid grid-cols-4 gap-1" aria-hidden="true">
      <span
        v-for="index in 4"
        :key="index"
        class="h-1.5 rounded-full"
        :class="index <= filled ? SEGMENT_COLOURS[strength] : 'bg-accented'"
      />
    </div>
    <p class="text-sm text-toned" aria-live="polite">
      <span v-if="strength === 0">{{ $t('auth.strength.tooShort') }}</span>
      <span v-else-if="strength === 1">{{ $t('auth.strength.weak') }}</span>
      <span v-else-if="strength === 2">{{ $t('auth.strength.fair') }}</span>
      <span v-else-if="strength === 3">{{ $t('auth.strength.good') }}</span>
      <span v-else>{{ $t('auth.strength.strong') }}</span>
    </p>
  </div>
</template>
