<script setup lang="ts">
import { generatePassword } from '@toascribe/shared'

// The field for choosing a password, with what helps to choose one: the show/hide button, the strength meter and «Generer
// passord». Used in a `UForm` by the two links in a mail (ChoosePassword) and by the profile's «Nytt passord». The form owns the
// validation; this only draws the field, so `name` must be the key of the form's state. `generate()` is also exposed, for a screen
// that starts with a password already made (WordPress' «Sett nytt passord»).
withDefaults(
  defineProps<{
    name?: string
    label?: string
    help?: string
  }>(),
  { name: 'password', label: undefined, help: undefined },
)

const password = defineModel<string>({ default: '' })
const visible = defineModel<boolean>('visible', { default: false })

const generated = ref(false)

function generate() {
  password.value = generatePassword()
  visible.value = true // shown, so it can be copied before it is saved
  generated.value = true
}

defineExpose({ generate })
</script>

<template>
  <div class="flex flex-col gap-6">
    <UFormField
      eager-validation
      :name="name"
      :label="label ?? $t('auth.choose.password')"
      :help="help ?? $t('auth.choose.help')"
    >
      <AuthPasswordInput v-model="password" v-model:visible="visible" autocomplete="new-password" />
    </UFormField>

    <div class="flex flex-col gap-2">
      <AuthStrengthMeter :password="password" />
      <UButton color="neutral" variant="outline" size="lg" class="min-h-11 self-start" @click="generate">
        {{ $t('auth.choose.generate') }}
      </UButton>
      <p v-if="generated" role="status" class="text-sm text-toned">{{ $t('auth.choose.generated') }}</p>
    </div>
  </div>
</template>
