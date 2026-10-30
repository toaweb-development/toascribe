<script setup lang="ts">
// The frame of every sign-in screen, like wp-login.php: the mark and the name of the site, the form in a box, the links below it.
// `heading` is the h1; the page sets the same text as its title.
const props = defineProps<{
  heading: string
}>()

// A new step (the login turns into «Bekreft innloggingen», a link into «Nytt passord») replaces the content under the person's
// hands, and the focus they were on is gone. It moves to the new h1, so a screen reader reads the step and the next Tab
// reaches its first control. Not on arrival: the browser starts at the top of a new page by itself.
const siteName = useSiteName()
const title = useTemplateRef<HTMLElement>('title')
watch(
  () => props.heading,
  async () => {
    await nextTick()
    title.value?.focus()
  },
)
</script>

<template>
  <!-- «Blekk» (M2.1): a page of its own on the app's background, with the mark and the site's name above the card. -->
  <div class="min-h-dvh bg-app">
    <main class="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-8">
      <p class="flex flex-col items-center gap-3 text-center print:hidden">
        <BlekkLogoMark size="lg" />
        <NuxtLink to="/" external class="rounded-menu text-page-title font-semibold text-heading hover:underline">{{
          siteName
        }}</NuxtLink>
      </p>

      <UCard>
        <h1 ref="title" tabindex="-1" class="mb-6 text-card-title font-semibold text-heading outline-none">
          {{ heading }}
        </h1>
        <div class="flex flex-col gap-6">
          <slot />
        </div>
      </UCard>

      <nav v-if="$slots.links" :aria-label="$t('auth.shell.linksLabel')" class="print:hidden">
        <ul class="flex flex-col items-start gap-1">
          <slot name="links" />
        </ul>
      </nav>

      <p class="print:hidden">
        <NuxtLink
          to="/"
          external
          class="inline-flex min-h-control items-center text-help text-secondary hover:text-heading hover:underline"
        >
          {{ $t('auth.shell.toSite', { site: siteName }) }}
        </NuxtLink>
      </p>
    </main>
  </div>
</template>
