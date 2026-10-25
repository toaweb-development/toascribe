<script setup lang="ts">
import type { FormErrorEvent, FormSubmitEvent } from '@nuxt/ui'
import type { MeResponse } from '@toascribe/shared'

// «Navn», «Kontaktinformasjon» and «Om deg selv» with the main button, «Oppdater profil» (WordPress' profile.php has one button for all
// of it). The name fields, the website and the biography go in one `PATCH /me`; a changed e-mail address is a request for a
// confirmation link (`POST /me/email-change`, which asks for the password) and the address stays as it is until the link is opened.
// The form is long (three sections), so a failed check gives an error summary with links and moves focus to it (workflows §13).
const props = defineProps<{ me: MeResponse }>()

const emit = defineEmits<{ saved: [me: MeResponse] }>()
/** True while the form holds edits that are not saved: the page warns before they are lost. */
const dirty = defineModel<boolean>('dirty', { default: false })

const { t } = useI18n()
const meApi = useMeApi()
const reauth = useReauth()

const form = reactive<ProfileFormState>(profileFormFrom(props.me))
const baseline = ref<ProfileFormState>({ ...form })
const formRef = useTemplateRef<{ setErrors: (errors: FieldError[]) => void; clear: () => void }>('formRef')
const { validateOn, failed } = useSubmitValidation()

const changed = computed(() => isProfileChanged(props.me.username, form, baseline.value))
watch(
  changed,
  (now) => {
    dirty.value = now
    if (now) {
      messages.value = []
    }
  },
  { immediate: true },
)

const options = computed(() => displayNameOptions(props.me.username, form))
// The select shows what is saved: when the chosen name goes empty (the first name is cleared), it falls back to the username.
watch(
  () => effectiveDisplayNameChoice(props.me.username, form),
  (choice) => {
    form.displayNameChoice = choice
  },
)

const labels = computed<Record<string, string>>(() => ({
  firstName: t('profile.name.firstName'),
  lastName: t('profile.name.lastName'),
  nickname: t('profile.name.nickname'),
  email: t('profile.contact.email'),
  website: t('profile.contact.website'),
  bio: t('profile.about.bio'),
}))

const submitting = ref(false)
const auth = useAuth()
const submitButton = useTemplateRef<{ $el: HTMLElement }>('submitButton')
/** What the last save did, said in the status region under the button. */
const messages = ref<{ icon: string; text: string }[]>([])
const summary = ref<FieldError[]>([])
const summaryEl = useTemplateRef<HTMLElement>('summaryEl')
const failure = ref<string>()

function validate(state: Partial<ProfileFormState>) {
  return validateProfile({ ...form, ...state }, t)
}

async function onInvalid(event: FormErrorEvent) {
  failed()
  summary.value = event.errors.flatMap((error) =>
    error.name === undefined ? [] : [{ name: error.name, message: error.message }],
  )
  failure.value = undefined
  await nextTick()
  await nextTick()
  summaryEl.value?.focus()
}

function goTo(name: string) {
  document.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]`)?.focus()
}

function fieldError(name: string, message: string) {
  formRef.value?.setErrors([{ name, message }])
  summary.value = [{ name, message }]
}

async function onSubmit(event: FormSubmitEvent<ProfileFormState>) {
  summary.value = []
  failure.value = undefined
  messages.value = []
  submitting.value = true
  const done: { icon: string; text: string }[] = []
  try {
    let current = props.me
    const profileChanged = profileChanges(props.me.username, form)
    const before = profileChanges(props.me.username, baseline.value)
    if (PROFILE_FIELDS.some((field) => profileChanged[field] !== before[field])) {
      current = await meApi.updateProfile(profileChanged)
      baseline.value = { ...baseline.value, ...profileFormFrom({ ...current, email: baseline.value.email }) }
      Object.assign(form, { ...profileFormFrom(current), email: form.email })
      emit('saved', current)
      // «Hei, {name}» in the bar follows the new display name.
      await auth.refresh().catch(() => undefined)
      done.push({ icon: 'i-lucide-check', text: t('profile.saved') })
    }
    const wanted = event.data.email.trim()
    if (wanted !== current.email) {
      const outcome = await reauth.ask({
        title: t('profile.contact.confirmTitle'),
        description: t('profile.contact.confirmText', { email: wanted }),
        confirmLabel: t('profile.contact.confirmButton'),
        action: (password) => meApi.requestEmailChange(wanted, password),
      })
      if (outcome.status === 'done') {
        form.email = current.email
        done.push({ icon: 'i-lucide-mail', text: t('profile.contact.sent', { email: wanted }) })
      } else if (outcome.status === 'failed') {
        if (outcome.error.code === 'same_email' || outcome.error.code === 'email_unavailable') {
          fieldError('email', describeApiError(outcome.error, t))
          focusSoon(() => document.querySelector<HTMLElement>('[name="email"]'))
        } else {
          failure.value = describeApiError(outcome.error, t)
        }
      } else {
        done.push({ icon: 'i-lucide-info', text: t('profile.contact.skipped') })
      }
    }
    if (done.length === 0 && failure.value === undefined && summary.value.length === 0) {
      done.push({ icon: 'i-lucide-info', text: t('profile.nothingToSave') })
    }
    messages.value = done
  } catch (caught) {
    failure.value = describeApiError(caught, t)
    messages.value = done
  } finally {
    submitting.value = false
    // The button was disabled while it worked, which takes focus from it: put it back (a failed check puts it on the summary).
    if (summary.value.length === 0) {
      await nextTick()
      await nextTick()
      submitButton.value?.$el.focus()
    }
  }
}

// The form keeps what was typed when a call fails; a reload of the account (the page) is not expected to replace it.
defineExpose({ form })
</script>

<template>
  <UForm
    ref="formRef"
    :state="form"
    :validate="validate"
    novalidate
    :validate-on="validateOn"
    class="flex flex-col gap-4 sm:gap-6"
    @submit="onSubmit"
    @error="onInvalid"
  >
    <div
      v-if="summary.length"
      ref="summaryEl"
      tabindex="-1"
      role="group"
      aria-labelledby="profile-summary-title"
      class="outline-none"
    >
      <UAlert color="error" variant="subtle">
        <template #title>
          <span id="profile-summary-title">{{ $t('profile.summary.title') }}</span>
        </template>
        <template #description>
          <ul class="mt-1 flex flex-col gap-1">
            <li v-for="error in summary" :key="error.name">
              <a
                :href="`#${error.name}`"
                class="inline-flex min-h-11 items-center underline underline-offset-4 hover:no-underline"
                @click.prevent="goTo(error.name)"
              >
                {{ labels[error.name] ?? error.name }}: {{ error.message }}
              </a>
            </li>
          </ul>
        </template>
      </UAlert>
    </div>

    <ProfileSection id="name" :title="$t('profile.name.title')">
      <div class="flex flex-col gap-5">
        <UFormField name="username" :label="$t('profile.name.username')" :help="$t('profile.name.usernameHelp')">
          <UInput :model-value="me.username" readonly size="xl" fixed class="w-full" autocomplete="username" />
        </UFormField>
        <UFormField eager-validation name="firstName" :label="$t('profile.name.firstName')">
          <UInput v-model="form.firstName" size="xl" fixed class="w-full" autocomplete="given-name" />
        </UFormField>
        <UFormField eager-validation name="lastName" :label="$t('profile.name.lastName')">
          <UInput v-model="form.lastName" size="xl" fixed class="w-full" autocomplete="family-name" />
        </UFormField>
        <UFormField eager-validation name="nickname" :label="$t('profile.name.nickname')" required>
          <UInput v-model="form.nickname" size="xl" fixed class="w-full" autocomplete="nickname" />
        </UFormField>
        <!-- A native select (Nuxt UI's `USelect` is a Reka listbox whose server-rendered markup carries inline styles the CSP refuses). -->
        <div class="flex flex-col gap-1.5">
          <label for="display-name-choice" class="block font-medium text-default">
            {{ $t('profile.name.displayAs') }}
          </label>
          <select
            id="display-name-choice"
            v-model="form.displayNameChoice"
            name="displayNameChoice"
            aria-describedby="display-name-choice-help"
            class="block min-h-11 w-full rounded-md bg-default px-3 py-2 text-base text-highlighted ring ring-inset ring-accented focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
          >
            <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
          <p id="display-name-choice-help" class="text-sm text-muted">{{ $t('profile.name.displayAsHelp') }}</p>
        </div>
      </div>
    </ProfileSection>

    <ProfileSection id="contact" :title="$t('profile.contact.title')">
      <div class="flex flex-col gap-5">
        <UFormField
          eager-validation
          name="email"
          :label="$t('profile.contact.email')"
          :help="$t('profile.contact.emailHelp')"
          required
        >
          <UInput
            v-model="form.email"
            type="email"
            size="xl"
            fixed
            class="w-full"
            autocomplete="email"
            inputmode="email"
          />
        </UFormField>
        <UFormField eager-validation name="website" :label="$t('profile.contact.website')">
          <UInput
            v-model="form.website"
            type="url"
            size="xl"
            fixed
            class="w-full"
            autocomplete="url"
            inputmode="url"
            autocapitalize="none"
            spellcheck="false"
          />
        </UFormField>
      </div>
    </ProfileSection>

    <ProfileSection id="about" :title="$t('profile.about.title')">
      <UFormField eager-validation name="bio" :label="$t('profile.about.bio')" :help="$t('profile.about.bioHelp')">
        <UTextarea v-model="form.bio" :rows="5" size="xl" fixed class="w-full" autoresize />
      </UFormField>
    </ProfileSection>

    <div class="flex flex-col gap-3">
      <p v-if="failure" role="alert" class="font-medium text-error">{{ failure }}</p>
      <div>
        <UButton
          ref="submitButton"
          type="submit"
          size="xl"
          class="min-h-11 min-w-44 justify-center"
          :loading="submitting"
        >
          {{ $t('profile.save') }}
        </UButton>
      </div>
      <!-- The region stays in the page, empty, so the text put into it is announced. -->
      <div role="status" class="flex min-h-6 flex-col gap-1 text-sm text-default">
        <span v-for="message in messages" :key="message.text" class="inline-flex items-start gap-1.5">
          <UIcon :name="message.icon" class="mt-0.5 size-4 shrink-0 text-toned" aria-hidden="true" />
          <span>{{ message.text }}</span>
        </span>
      </div>
    </div>
  </UForm>
</template>
