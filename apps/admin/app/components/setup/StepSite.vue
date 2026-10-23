<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { SetupSite } from '@toascribe/shared'

// Step 3: the site. Language (nb unless changed), title, time zone (Europe/Oslo unless changed, searchable), the address
// that gets the site's notices, and «Be søkemotorer om ikke å indeksere dette nettstedet» as WordPress words it (the box ticks
// the opposite of `blog_public`). Saved at once, so a reload brings the answers back.
const props = defineProps<{
  token: string
  /** What the api has saved, if the step was done before (a reload, or a step back). */
  saved: SetupSite | null
}>()

const emit = defineEmits<{ saved: [site: SetupSite]; installed: []; lost: [message: string]; back: [] }>()

const { t } = useI18n()
const setupApi = useSetupApi()
const { pending, error, failures, run } = useSetupRequest((lost) => {
  if (lost.kind === 'installed') {
    emit('installed')
  } else {
    emit('lost', lost.message)
  }
})

// What the browser knows; the list is long, so the menu has a search field.
const zones = timezoneChoices(
  typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : undefined,
)

// The languages that have a default content of their own. Any other tag would get the English text.
const languages = [
  { value: 'nb', label: t('setup.site.language.nb') },
  { value: 'en', label: t('setup.site.language.en') },
]

const state = reactive({
  locale: props.saved?.locale ?? 'nb',
  title: props.saved?.title ?? '',
  timezone: props.saved?.timezone ?? 'Europe/Oslo',
  adminEmail: props.saved?.adminEmail ?? '',
  discourage: props.saved === null ? false : !props.saved.blogPublic,
})

const { validateOn, failed } = useSubmitValidation()

function validate(current: Partial<typeof state>) {
  return validateSetupSite(current, t, zones)
}

async function onInvalid(event: Parameters<typeof focusFirstError>[0]) {
  failed()
  await focusFirstError(event)
}

async function onSubmit(event: FormSubmitEvent<typeof state>) {
  const site: SetupSite = {
    locale: event.data.locale,
    title: event.data.title.trim(),
    timezone: event.data.timezone,
    adminEmail: event.data.adminEmail.trim(),
    blogPublic: !event.data.discourage,
  }
  const answer = await run(() => setupApi.saveSite(props.token, site))
  if (answer !== undefined) {
    emit('saved', answer.site)
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <p class="text-base text-default">{{ $t('setup.site.intro') }}</p>
    <AuthMessage v-if="error" :key="failures" kind="error" focus>{{ error }}</AuthMessage>
    <UForm
      :state="state"
      :validate="validate"
      novalidate
      :validate-on="validateOn"
      class="flex flex-col gap-6"
      @submit="onSubmit"
      @error="onInvalid"
    >
      <UFormField eager-validation name="title" :label="$t('setup.site.title')" :help="$t('setup.site.titleHelp')">
        <UInput v-model="state.title" autocomplete="off" size="xl" fixed class="w-full" />
      </UFormField>

      <UFormField name="locale" :label="$t('setup.site.language.label')" :help="$t('setup.site.language.help')">
        <USelect v-model="state.locale" :items="languages" value-key="value" size="xl" fixed class="w-full" />
      </UFormField>

      <UFormField name="timezone" :label="$t('setup.site.timezone.label')" :help="$t('setup.site.timezone.help')">
        <USelectMenu
          v-model="state.timezone"
          :items="zones"
          :search-input="{ placeholder: $t('setup.site.timezone.search') }"
          size="xl"
          fixed
          class="w-full"
        />
      </UFormField>

      <UFormField
        eager-validation
        name="adminEmail"
        :label="$t('setup.site.adminEmail')"
        :help="$t('setup.site.adminEmailHelp')"
      >
        <UInput
          v-model="state.adminEmail"
          type="email"
          autocomplete="email"
          inputmode="email"
          autocapitalize="none"
          spellcheck="false"
          size="xl"
          fixed
          class="w-full"
        />
      </UFormField>

      <fieldset class="flex flex-col gap-2">
        <legend class="mb-2 text-sm font-medium text-default">{{ $t('setup.site.visibility.legend') }}</legend>
        <UCheckbox
          v-model="state.discourage"
          size="lg"
          :label="$t('setup.site.visibility.label')"
          :description="$t('setup.site.visibility.help')"
        />
      </fieldset>

      <div class="flex flex-wrap gap-2">
        <UButton color="neutral" variant="outline" size="xl" class="min-h-11" @click="emit('back')">{{
          $t('setup.nav.back')
        }}</UButton>
        <UButton type="submit" size="xl" class="min-h-11" :loading="pending">{{ $t('setup.nav.next') }}</UButton>
      </div>
    </UForm>
  </div>
</template>
