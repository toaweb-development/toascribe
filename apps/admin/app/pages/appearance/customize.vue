<script setup lang="ts">
import { CUSTOMIZE_PREVIEW_READY } from '@toascribe/shared'
import type { CustomizePreviewMessage, CustomizeResponse, ReadingSettings } from '@toascribe/shared'

// «Utseende → Tilpass» (M1.5, K-150, K-151; WordPress' Customizer): the site's identity (title, tagline, logo, icon), the active
// theme's colours and fonts (theme.json `settings`), the front page (with manage_options) and «Ekstra CSS» (edit_css), beside a
// preview of the site. The preview is the site itself in a frame on the same origin: this page posts the choices not saved yet,
// and the site draws them in that page (plugins/customize-preview.client.ts in site-core). Nothing is stored before «Publiser».
// The front page is not previewed live: it is a different page, and it shows once it is published.
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t } = useI18n()
const auth = useAuth()
const appearanceApi = useAppearanceApi()
const settingsApi = useSettingsApi()
const activeTheme = useActiveTheme()
const mediaRefs = useMediaRefs()
useSeoMeta({ title: () => t('appearance.customize.title') })

const capabilities = computed(() =>
  auth.session.value.status === 'authenticated' ? auth.session.value.account.capabilities : [],
)
const mayEdit = computed(() => capabilities.value.includes('edit_theme_options'))
const mayManage = computed(() => capabilities.value.includes('manage_options'))
if (import.meta.server && !mayEdit.value) {
  const event = useRequestEvent()
  if (event) setResponseStatus(event, 403)
}

// The theme is known in the browser only (the site answers /_toascribe/theme), so the choices are read once it is.
const loaded = ref<CustomizeResponse>()
const loadFailed = ref(false)
const identity = ref({
  blogname: '',
  blogdescription: '',
  site_logo: null as string | null,
  site_icon: null as string | null,
})
const colors = ref<Record<string, string>>({})
const fonts = ref<Record<string, string>>({})
const customCss = ref('')
const reading = ref<Pick<ReadingSettings, 'show_on_front' | 'page_on_front' | 'page_for_posts'>>()
const readingAsLoaded = ref<string>()

function take(answer: CustomizeResponse): void {
  loaded.value = answer
  identity.value = { ...answer.identity }
  for (const media of answer.media) mediaRefs.value.set(media.id, media)
  const spec = activeTheme.value?.settings
  colors.value = Object.fromEntries(
    Object.entries(spec?.colors ?? {}).map(([slug, color]) => [
      slug,
      answer.customization.colors[slug] ?? color.default,
    ]),
  )
  fonts.value = Object.fromEntries(
    Object.entries(spec?.fonts ?? {}).map(([slug, font]) => [
      slug,
      font.choices.some((choice) => choice.value === answer.customization.fonts[slug])
        ? (answer.customization.fonts[slug] ?? font.default)
        : font.default,
    ]),
  )
  customCss.value = answer.customization.customCss
}

watch(
  activeTheme,
  async (theme) => {
    if (import.meta.server || theme === null || !mayEdit.value || loaded.value !== undefined) return
    try {
      const [answer, settings] = await Promise.all([
        appearanceApi.customize(theme.slug),
        mayManage.value ? settingsApi.reading() : Promise.resolve(undefined),
      ])
      take(answer)
      if (settings !== undefined) {
        const { show_on_front, page_on_front, page_for_posts } = settings.settings
        reading.value = { show_on_front, page_on_front, page_for_posts }
        readingAsLoaded.value = JSON.stringify(reading.value)
      }
    } catch {
      loadFailed.value = true
    }
  },
  { immediate: true },
)

// The front page: the published pages, as in «Innstillinger → Lesing».
const { data: pages } = await usePageChoices('customize', 'publish')
const NONE = '__none__'
const withNone = computed(() => [{ label: t('settings.reading.choose'), value: NONE }, ...pages.value])
const shows = computed(() => [
  { label: t('settings.reading.latestPosts'), value: 'posts' },
  { label: t('settings.reading.staticPage'), value: 'page' },
])
const pageModel = (key: 'page_on_front' | 'page_for_posts') =>
  computed({
    get: () => reading.value?.[key] ?? NONE,
    set: (value: string) => {
      if (reading.value) reading.value[key] = value === NONE ? null : value
    },
  })
const frontPage = pageModel('page_on_front')
const postsPage = pageModel('page_for_posts')

const fontItems = (slug: string) =>
  (activeTheme.value?.settings.fonts?.[slug]?.choices ?? []).map((choice) => ({
    label: choice.label,
    value: choice.value,
  }))
const resetColor = (slug: string) => {
  const fallback = activeTheme.value?.settings.colors?.[slug]?.default
  if (fallback !== undefined) colors.value[slug] = fallback
}

// The preview: the site's front page in a frame, told the choices whenever they change and whenever it (re)loads.
const frame = useTemplateRef<HTMLIFrameElement>('preview')
function image(id: string | null): CustomizePreviewMessage['logo'] {
  const found = id === null ? undefined : mediaRefs.value.get(id)
  return found === undefined
    ? null
    : { id: found.id, url: found.url, width: found.width, height: found.height, alt: found.alt }
}
function message(): CustomizePreviewMessage {
  return {
    type: 'toascribe:customize',
    title: identity.value.blogname,
    tagline: identity.value.blogdescription,
    customization: { colors: { ...colors.value }, fonts: { ...fonts.value }, customCss: customCss.value },
    logo: image(identity.value.site_logo),
    icon: image(identity.value.site_icon),
  }
}
function tellPreview(): void {
  if (loaded.value === undefined) return
  frame.value?.contentWindow?.postMessage(message(), window.location.origin)
}
watch([identity, colors, fonts, customCss], tellPreview, { deep: true })
function onMessage(event: MessageEvent<unknown>): void {
  if (event.origin !== window.location.origin || event.source !== frame.value?.contentWindow) return
  if (
    typeof event.data === 'object' &&
    event.data !== null &&
    Reflect.get(event.data, 'type') === CUSTOMIZE_PREVIEW_READY
  ) {
    tellPreview()
  }
}
onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => window.removeEventListener('message', onMessage))

// «Publiser»: the choices in one call, the front page in «Lesing»'s (manage_options), then the preview from what was stored.
const saving = ref(false)
const report = ref<string>()
const failure = ref<string>()
async function publish(): Promise<void> {
  const theme = activeTheme.value
  if (theme === null || loaded.value === undefined) return
  saving.value = true
  report.value = undefined
  failure.value = undefined
  try {
    const answer = await appearanceApi.saveCustomize({
      theme: theme.slug,
      identity: loaded.value.mayEditIdentity ? { ...identity.value } : { site_logo: identity.value.site_logo },
      colors: { ...colors.value },
      fonts: { ...fonts.value },
      ...(loaded.value.mayEditCss ? { customCss: customCss.value } : {}),
    })
    if (reading.value !== undefined && JSON.stringify(reading.value) !== readingAsLoaded.value) {
      await settingsApi.updateReading({ ...reading.value })
      readingAsLoaded.value = JSON.stringify(reading.value)
    }
    take(answer)
    report.value = t('appearance.customize.published')
    frame.value?.contentWindow?.location.reload()
  } catch (caught) {
    failure.value = describeApiError(caught, t)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="appearance-customize">
    <template #header>
      <UDashboardNavbar :title="$t('appearance.customize.title')">
        <template #right>
          <UButton
            v-if="mayEdit && loaded"
            size="lg"
            class="min-h-11"
            :loading="saving"
            :label="$t('appearance.customize.publish')"
            @click="publish"
          />
        </template>
      </UDashboardNavbar>
    </template>
    <template #body>
      <section v-if="!mayEdit" aria-labelledby="customize-denied" class="flex max-w-prose flex-col gap-3">
        <h2 id="customize-denied" class="text-xl font-semibold text-highlighted">{{ $t('appearance.denied') }}</h2>
        <p class="text-base text-default">{{ $t('content.denied.text') }}</p>
      </section>
      <div v-else class="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div class="flex w-full flex-col gap-6 lg:w-96 lg:shrink-0">
          <p role="status" class="sr-only">{{ report }}</p>
          <UAlert v-if="report" color="success" variant="subtle" icon="i-lucide-check" :title="report" />
          <UAlert
            v-if="failure || loadFailed"
            color="error"
            variant="subtle"
            role="alert"
            icon="i-lucide-triangle-alert"
            :title="$t('appearance.customize.failed')"
            :description="failure"
          />
          <p v-if="!loaded && !loadFailed" class="text-sm text-muted">{{ $t('appearance.customize.loading') }}</p>
          <template v-if="loaded">
            <fieldset class="flex flex-col gap-4">
              <legend class="mb-2 text-lg font-semibold text-highlighted">
                {{ $t('appearance.customize.identity') }}
              </legend>
              <template v-if="loaded.mayEditIdentity">
                <UFormField :label="$t('appearance.customize.siteTitle')" name="blogname">
                  <UInput v-model="identity.blogname" maxlength="200" size="xl" class="w-full" />
                </UFormField>
                <UFormField :label="$t('appearance.customize.tagline')" name="blogdescription">
                  <UInput v-model="identity.blogdescription" maxlength="500" size="xl" class="w-full" />
                </UFormField>
              </template>
              <ContentFeaturedImage
                v-model="identity.site_logo"
                :label="$t('appearance.customize.logo')"
                :choose-label="$t('appearance.customize.chooseLogo')"
              />
              <ContentFeaturedImage
                v-if="loaded.mayEditIdentity"
                v-model="identity.site_icon"
                :label="$t('appearance.customize.icon')"
                :help="$t('appearance.customize.iconHelp')"
                :choose-label="$t('appearance.customize.chooseIcon')"
              />
            </fieldset>

            <fieldset v-if="Object.keys(colors).length > 0" class="flex flex-col gap-4">
              <legend class="mb-2 text-lg font-semibold text-highlighted">
                {{ $t('appearance.customize.colors') }}
              </legend>
              <div
                v-for="(spec, slug) in activeTheme?.settings.colors ?? {}"
                :key="slug"
                class="flex flex-wrap items-end gap-2"
              >
                <UFormField :label="spec.name" :name="`color-${slug}`">
                  <UInput v-model="colors[slug]" type="color" size="xl" class="w-24" />
                </UFormField>
                <code class="pb-3 text-sm text-muted">{{ colors[slug] }}</code>
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  class="min-h-11"
                  :aria-label="$t('appearance.customize.resetNamed', { name: spec.name })"
                  :label="$t('appearance.customize.reset')"
                  @click="resetColor(String(slug))"
                />
              </div>
            </fieldset>

            <fieldset v-if="Object.keys(fonts).length > 0" class="flex flex-col gap-4">
              <legend class="mb-2 text-lg font-semibold text-highlighted">
                {{ $t('appearance.customize.fonts') }}
              </legend>
              <UFormField
                v-for="(spec, slug) in activeTheme?.settings.fonts ?? {}"
                :key="slug"
                :label="spec.name"
                :name="`font-${slug}`"
              >
                <USelect v-model="fonts[slug]" :items="fontItems(String(slug))" size="xl" class="w-full" />
              </UFormField>
            </fieldset>

            <fieldset v-if="reading" class="flex flex-col gap-3">
              <legend class="mb-2 text-lg font-semibold text-highlighted">
                {{ $t('settings.reading.frontShows') }}
              </legend>
              <URadioGroup v-model="reading.show_on_front" :items="shows" />
              <div v-if="reading.show_on_front === 'page'" class="flex flex-col gap-3 ps-6">
                <UFormField :label="$t('settings.reading.frontPage')" name="page_on_front">
                  <USelect v-model="frontPage" :items="withNone" size="xl" class="w-full" />
                </UFormField>
                <UFormField :label="$t('settings.reading.postsPage')" name="page_for_posts">
                  <USelect v-model="postsPage" :items="withNone" size="xl" class="w-full" />
                </UFormField>
              </div>
              <p class="text-sm text-toned">{{ $t('appearance.customize.frontHelp') }}</p>
            </fieldset>

            <fieldset v-if="loaded.mayEditCss" class="flex flex-col gap-2">
              <legend class="mb-2 text-lg font-semibold text-highlighted">{{ $t('appearance.customize.css') }}</legend>
              <UFormField :help="$t('appearance.customize.cssHelp')" name="custom-css">
                <UTextarea
                  v-model="customCss"
                  :rows="10"
                  autoresize
                  spellcheck="false"
                  :aria-label="$t('appearance.customize.css')"
                  class="w-full font-mono"
                />
              </UFormField>
            </fieldset>
          </template>
        </div>
        <section aria-labelledby="customize-preview" class="flex min-w-0 flex-1 flex-col gap-2">
          <h2 id="customize-preview" class="text-lg font-semibold text-highlighted">
            {{ $t('appearance.customize.preview') }}
          </h2>
          <iframe
            ref="preview"
            src="/"
            :title="$t('appearance.customize.previewFrame')"
            class="h-[70vh] w-full rounded-md border border-default bg-default"
          />
        </section>
      </div>
    </template>
  </UDashboardPanel>
</template>
