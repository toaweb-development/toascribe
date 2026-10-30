<script setup lang="ts">
// One copy of every «Blekk» component and variant (M2.1), for /admin/_ui: buttons, fields, select, checkbox, switch, card, badge,
// tabs, table, alert, empty state, skeleton and modal. The page draws it twice, once with the light tokens and once with the dark.
const { t } = useI18n()
const props = defineProps<{ theme: 'light' | 'dark' }>()
const id = (name: string) => `ui-${props.theme}-${name}`

const text = ref('')
const choice = ref('one')
const checked = ref(true)
const on = ref(true)
const open = ref(false)
const tab = ref('first')
const items = computed(() => [
  { value: 'one', label: t('uiShowcase.option', { n: 1 }) },
  { value: 'two', label: t('uiShowcase.option', { n: 2 }) },
])
const views = computed(() => [
  { key: 'all', label: t('content.views.all'), count: 12, to: { query: { view: 'all' } }, current: true },
  { key: 'publish', label: t('content.views.publish'), count: 9, to: { query: { view: 'publish' } }, current: false },
  { key: 'draft', label: t('content.views.draft'), count: 3, to: { query: { view: 'draft' } }, current: false },
])
const tabs = computed(() => [
  { label: t('uiShowcase.tabFirst'), value: 'first' },
  { label: t('uiShowcase.tabSecond'), value: 'second' },
])
const COLORS = ['neutral', 'primary', 'success', 'warning', 'error', 'info'] as const
const ALERTS = ['info', 'success', 'warning', 'error'] as const
</script>

<template>
  <div class="flex flex-col gap-8 bg-app p-6 text-default">
    <section :aria-labelledby="id('buttons')" class="flex flex-col gap-3">
      <h3 :id="id('buttons')" class="text-card-title font-semibold text-heading">{{ $t('uiShowcase.buttons') }}</h3>
      <div class="flex flex-wrap items-center gap-3">
        <UButton size="xl">{{ $t('uiShowcase.primary') }}</UButton>
        <UButton color="neutral" variant="outline">{{ $t('uiShowcase.secondary') }}</UButton>
        <UButton variant="link">{{ $t('uiShowcase.text') }}</UButton>
        <UButton color="error" variant="outline">{{ $t('uiShowcase.danger') }}</UButton>
        <UButton color="neutral" variant="ghost" icon="i-lucide-columns-3" :aria-label="$t('uiShowcase.icon')" />
        <UButton color="neutral" variant="outline" disabled>{{ $t('uiShowcase.disabled') }}</UButton>
        <UButton color="neutral" variant="outline" loading>{{ $t('uiShowcase.loading') }}</UButton>
      </div>
    </section>

    <section :aria-labelledby="id('fields')" class="grid gap-4 sm:grid-cols-2">
      <h3 :id="id('fields')" class="text-card-title font-semibold text-heading sm:col-span-2">
        {{ $t('uiShowcase.fields') }}
      </h3>
      <UFormField :label="$t('uiShowcase.field')" :help="$t('uiShowcase.help')" :name="id('field')">
        <UInput :id="id('field')" v-model="text" class="w-full" :placeholder="$t('uiShowcase.placeholder')" />
      </UFormField>
      <UFormField :label="$t('uiShowcase.fieldError')" :error="$t('uiShowcase.error')" :name="id('field-error')">
        <UInput :id="id('field-error')" class="w-full" />
      </UFormField>
      <UFormField :label="$t('uiShowcase.select')" :name="id('select')">
        <USelect :id="id('select')" v-model="choice" :items="items" class="w-full" />
      </UFormField>
      <div class="flex flex-col gap-3">
        <UCheckbox v-model="checked" :label="$t('uiShowcase.checkbox')" />
        <USwitch v-model="on" :label="$t('uiShowcase.switch')" />
      </div>
    </section>

    <section :aria-labelledby="id('badges')" class="flex flex-col gap-3">
      <h3 :id="id('badges')" class="text-card-title font-semibold text-heading">{{ $t('uiShowcase.badges') }}</h3>
      <div class="flex flex-wrap gap-2">
        <UBadge v-for="color in COLORS" :key="color" :color="color" variant="subtle">{{ color }}</UBadge>
      </div>
    </section>

    <section :aria-labelledby="id('tabs')" class="flex flex-col gap-3">
      <h3 :id="id('tabs')" class="text-card-title font-semibold text-heading">{{ $t('uiShowcase.tabs') }}</h3>
      <BlekkViewTabs :items="views" :label="$t('uiShowcase.views')" />
      <UTabs v-model="tab" :items="tabs" :content="false" color="neutral" variant="link" />
    </section>

    <section :aria-labelledby="id('card')" class="grid gap-4 lg:grid-cols-2">
      <h3 :id="id('card')" class="text-card-title font-semibold text-heading lg:col-span-2">
        {{ $t('uiShowcase.cardAndTable') }}
      </h3>
      <UCard>
        <template #header>
          <p class="text-card-title font-semibold text-heading">{{ $t('uiShowcase.card') }}</p>
        </template>
        <p class="text-body">
          {{ $t('uiShowcase.running') }}
          <ULink to="/" class="text-accent-text underline underline-offset-4">{{ $t('uiShowcase.link') }}</ULink>
        </p>
        <p class="mt-2 font-mono text-help text-secondary">{{ $t('uiShowcase.mono') }}</p>
      </UCard>
      <BlekkTableFrame :label="$t('uiShowcase.table')">
        <table class="w-full min-w-96 text-start text-body">
          <caption class="sr-only">
            {{
              $t('uiShowcase.table')
            }}
          </caption>
          <thead>
            <tr class="border-b border-line">
              <th
                v-for="n in 3"
                :key="n"
                scope="col"
                class="px-3 py-2 text-start text-badge font-semibold tracking-wide text-secondary uppercase"
              >
                {{ $t('uiShowcase.column', { n }) }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-divider">
            <tr v-for="row in 2" :key="row" class="group hover:bg-sunken">
              <th scope="row" class="px-3 py-3 text-start font-semibold text-heading">
                {{ $t('uiShowcase.row', { n: row }) }}
                <span class="flex gap-3 font-normal">
                  <button
                    type="button"
                    class="inline-flex min-h-control items-center text-help text-accent-text hover:underline"
                  >
                    {{ $t('content.actions.edit') }}
                  </button>
                  <button
                    type="button"
                    class="inline-flex min-h-control items-center text-help text-danger hover:underline"
                  >
                    {{ $t('content.actions.trash') }}
                  </button>
                </span>
              </th>
              <td class="px-3 py-3">—</td>
              <td class="px-3 py-3 font-mono text-help">{{ $t('uiShowcase.date') }}</td>
            </tr>
          </tbody>
        </table>
      </BlekkTableFrame>
    </section>

    <section :aria-labelledby="id('alerts')" class="flex flex-col gap-3">
      <h3 :id="id('alerts')" class="text-card-title font-semibold text-heading">{{ $t('uiShowcase.alerts') }}</h3>
      <UAlert
        v-for="color in ALERTS"
        :key="color"
        :color="color"
        variant="subtle"
        :title="$t('uiShowcase.alert', { color })"
      />
    </section>

    <section :aria-labelledby="id('states')" class="grid gap-4 lg:grid-cols-2">
      <h3 :id="id('states')" class="text-card-title font-semibold text-heading lg:col-span-2">
        {{ $t('uiShowcase.states') }}
      </h3>
      <BlekkEmptyState :title="$t('uiShowcase.empty')" :text="$t('uiShowcase.emptyText')">
        <UButton color="neutral" variant="outline">{{ $t('uiShowcase.secondary') }}</UButton>
      </BlekkEmptyState>
      <div class="flex flex-col gap-2" aria-hidden="true">
        <USkeleton role="presentation" aria-hidden="true" aria-label="" class="h-5 w-56" />
        <USkeleton role="presentation" aria-hidden="true" aria-label="" class="h-5 w-40" />
        <USkeleton role="presentation" aria-hidden="true" aria-label="" class="h-24 w-full rounded-card" />
      </div>
      <div>
        <UModal v-model:open="open" :title="$t('uiShowcase.modal')" :description="$t('uiShowcase.modalText')">
          <UButton color="neutral" variant="outline">{{ $t('uiShowcase.openModal') }}</UButton>
          <template #footer>
            <UButton @click="open = false">{{ $t('uiShowcase.primary') }}</UButton>
          </template>
        </UModal>
      </div>
    </section>
  </div>
</template>
