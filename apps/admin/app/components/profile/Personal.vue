<script setup lang="ts">
import { ADMIN_COLOR_SCHEMES } from '@toascribe/shared'
import type { AdminColorScheme } from '@toascribe/shared'

// «Personlige valg» (WordPress): the admin colour scheme and the toolbar on the site. The two choices are saved the moment they are
// made, not with «Oppdater profil»: WordPress previews a colour scheme at once, and the other choice is a single switch. The result is
// said in place (a status line under the choices), because the person is looking at it.
const { t } = useI18n()
const { preferences, failed, reload, update } = useAdminPreferences()
const colorScheme = useAdminColorScheme()

const saving = ref<'scheme' | 'toolbar'>()
const message = ref('')
const failure = ref<string>()

const items = computed(() =>
  ADMIN_COLOR_SCHEMES.map((scheme) => ({
    value: scheme,
    label: schemeName({ t }, scheme),
    description: schemeHint({ t }, scheme),
  })),
)

async function save(which: 'scheme' | 'toolbar', run: () => Promise<unknown>, done: string) {
  saving.value = which
  failure.value = undefined
  message.value = ''
  try {
    await run()
    message.value = done
  } catch (caught) {
    failure.value = describeApiError(caught, t)
  } finally {
    saving.value = undefined
  }
}

const scheme = computed<AdminColorScheme>({
  get: () => colorScheme.scheme.value,
  set: (next) => {
    if (next !== colorScheme.scheme.value) {
      void save(
        'scheme',
        () => colorScheme.set(next),
        t('profile.personal.schemeSaved', { name: schemeName({ t }, next) }),
      )
    }
  },
})

// Shown as soon as it is pressed, and put back if the save fails.
const toolbarShown = ref(preferences.value?.showToolbarOnSite ?? true)
watch(
  () => preferences.value?.showToolbarOnSite,
  (value) => {
    toolbarShown.value = value ?? true
  },
)
const toolbar = computed<boolean>({
  get: () => toolbarShown.value,
  set: (next) => {
    toolbarShown.value = next
    void save(
      'toolbar',
      () => update({ showToolbarOnSite: next }),
      next ? t('profile.personal.toolbarOn') : t('profile.personal.toolbarOff'),
    ).then(() => {
      if (failure.value !== undefined) {
        toolbarShown.value = preferences.value?.showToolbarOnSite ?? true
      }
    })
  },
})

const retrying = ref(false)
async function retry() {
  retrying.value = true
  await reload()
  retrying.value = false
}
</script>

<template>
  <ProfileSection id="personal" :title="$t('profile.personal.title')">
    <div v-if="preferences" class="flex flex-col gap-6">
      <!--
        Reka's radio group and checkbox write an inline `style` attribute into the server-rendered HTML (`outline:none`, `pointer-events:none`), which the
        admin's CSP refuses (`style-src-attr` allows only the three strings of the sidebar and the accordion). In the browser the same
        styles are set through the CSSOM, which the policy allows, so the two controls are drawn there and not by the server.
      -->
      <ClientOnly>
        <URadioGroup
          v-model="scheme"
          :items="items"
          :legend="$t('profile.personal.scheme')"
          variant="card"
          indicator="hidden"
          size="lg"
          :disabled="saving === 'scheme'"
          :ui="{
            fieldset: 'grid grid-cols-1 gap-3 sm:grid-cols-2',
            item: 'min-h-11 p-3 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary',
            wrapper: 'text-start items-start',
            description: 'text-toned',
          }"
        >
          <!-- `v-slot:label`, not `#label`: the root i18n test reads `#label="…"` as a hard-coded text attribute. -->
          <!-- eslint-disable-next-line vue/v-slot-style -->
          <template v-slot:label="{ item }">
            <span class="flex flex-col gap-2">
              <span class="flex items-center gap-2">
                <span class="flex shrink-0 overflow-hidden rounded-sm ring ring-accented" aria-hidden="true">
                  <span
                    v-for="swatch in SCHEME_SWATCHES[item.value as AdminColorScheme]"
                    :key="swatch"
                    class="block h-5 w-5"
                    :class="swatch"
                  />
                </span>
                <span class="font-medium text-default">{{ item.label }}</span>
                <UIcon
                  v-if="scheme === item.value"
                  name="i-lucide-check"
                  class="size-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
              </span>
            </span>
          </template>
        </URadioGroup>

        <fieldset class="flex flex-col gap-1">
          <legend class="mb-1 block text-sm font-medium text-default">{{ $t('profile.personal.toolbar') }}</legend>
          <UCheckbox
            v-model="toolbar"
            size="lg"
            :disabled="saving === 'toolbar'"
            :label="$t('profile.personal.toolbarLabel')"
          />
        </fieldset>

        <template #fallback>
          <div class="flex flex-col gap-3" aria-busy="true">
            <USkeleton class="h-36 w-full sm:h-24" />
            <USkeleton class="h-11 w-2/3" />
          </div>
        </template>
      </ClientOnly>

      <!-- The region stays in the page, empty, so the text put into it is announced. -->
      <div role="status" class="min-h-6 text-sm text-default">
        <span v-if="message" class="inline-flex items-center gap-1.5">
          <UIcon name="i-lucide-check" class="size-4 shrink-0 text-success" aria-hidden="true" />
          {{ message }}
        </span>
      </div>
      <p v-if="failure" role="alert" class="font-medium text-error">
        {{ $t('profile.personal.failed') }} {{ failure }}
      </p>
    </div>

    <UAlert
      v-else-if="failed"
      color="error"
      variant="subtle"
      role="alert"
      :title="$t('profile.personal.loadFailed.title')"
      :description="$t('profile.personal.loadFailed.text')"
    >
      <template #actions>
        <UButton color="neutral" variant="outline" size="lg" class="min-h-11" :loading="retrying" @click="retry">
          {{ $t('profile.retry') }}
        </UButton>
      </template>
    </UAlert>
    <div v-else class="flex flex-col gap-3" aria-busy="true">
      <USkeleton class="h-16 w-full" />
      <USkeleton class="h-6 w-2/3" />
    </div>
  </ProfileSection>
</template>
