<script setup lang="ts">
import type { UserRoleOption } from '@toascribe/shared'

// «Endre rolle til…» and «Endre» (WordPress' bulk change of role). Only a role the signed-in account may give is offered (`grantable`).
// «Endre» does nothing until someone is ticked and a role is chosen. It stays in the tab order with `aria-disabled` and says why in text
// (workflows §19), instead of a native `disabled` that nobody can focus or ask about.
const props = defineProps<{
  roles: readonly UserRoleOption[]
  selectedCount: number
  busy: boolean
}>()

const role = defineModel<string>('role', { required: true })
const emit = defineEmits<{ submit: [] }>()

const { t } = useI18n()
const ready = computed(() => props.selectedCount > 0 && role.value !== '')

const hint = computed(() => {
  if (props.selectedCount === 0) {
    return t('users.bulk.needUsers')
  }
  return role.value === '' ? t('users.bulk.needRole') : ''
})

function submit() {
  if (ready.value && !props.busy) {
    emit('submit')
  }
}
</script>

<template>
  <form class="flex flex-wrap items-end gap-2" @submit.prevent="submit">
    <div class="flex min-w-0 flex-col gap-1.5">
      <label for="users-bulk-role" class="font-medium text-default">{{ $t('users.bulk.label') }}</label>
      <select
        id="users-bulk-role"
        v-model="role"
        name="role"
        class="block min-h-11 w-full rounded-md bg-default px-3 py-2 text-base text-highlighted ring ring-inset ring-accented focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none sm:w-56"
      >
        <option value="">{{ $t('users.bulk.choose') }}</option>
        <option v-for="option in roles" :key="option.slug" :value="option.slug">
          {{ roleLabel(t, option.slug, option.name) }}
        </option>
      </select>
    </div>
    <UButton
      type="submit"
      size="lg"
      class="min-h-11"
      :loading="busy"
      :aria-disabled="!ready"
      :aria-describedby="hint === '' ? undefined : 'users-bulk-hint'"
    >
      {{ $t('users.bulk.submit') }}
    </UButton>
    <p v-if="hint !== ''" id="users-bulk-hint" class="basis-full text-sm text-toned">{{ hint }}</p>
    <!-- Always in the page, so a change of its text is announced (accessibility §8). -->
    <p role="status" class="basis-full text-sm text-default">
      {{ selectedCount > 0 ? $t('users.bulk.selected', selectedCount) : '' }}
    </p>
  </form>
</template>
