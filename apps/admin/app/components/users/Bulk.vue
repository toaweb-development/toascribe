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
// Reka's select has no empty option, so «no role chosen yet» is the placeholder («Velg…») and an empty `role` for the page.
const chosen = computed<string | undefined>({
  get: () => (role.value === '' ? undefined : role.value),
  set: (next) => {
    role.value = next ?? ''
  },
})
const items = computed(() =>
  props.roles.map((option) => ({ value: option.slug, label: roleLabel(t, option.slug, option.name) })),
)
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
    <UFormField :label="$t('users.bulk.label')" name="role" class="min-w-0">
      <USelect
        id="users-bulk-role"
        v-model="chosen"
        :items="items"
        :placeholder="$t('users.bulk.choose')"
        size="xl"
        class="min-h-11 w-full sm:w-56"
      />
    </UFormField>
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
