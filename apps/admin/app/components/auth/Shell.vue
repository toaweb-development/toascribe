<script setup lang="ts">
// The frame of every sign-in screen, like wp-login.php: the name of the site, the form in a box, the links below it.
// `heading` is the h1; the page sets the same text as its title.
const props = defineProps<{
  heading: string
}>()

// A new step (the login turns into «Bekreft innloggingen», a link into «Nytt passord») replaces the content under the person's
// hands, and the focus they were on is gone. It moves to the new h1, so a screen reader reads the step and the next Tab
// reaches its first control. Not on arrival: the browser starts at the top of a new page by itself.
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
  <main class="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-8">
    <p class="text-center text-3xl font-bold text-highlighted print:hidden">
      <NuxtLink to="/" external class="rounded-md focus-visible:outline-2 focus-visible:outline-primary">{{
        $t('brand.name')
      }}</NuxtLink>
    </p>

    <UCard>
      <h1 ref="title" tabindex="-1" class="mb-6 text-xl font-semibold text-highlighted outline-none">{{ heading }}</h1>
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
        class="inline-flex min-h-11 items-center text-sm text-toned underline underline-offset-4 hover:text-highlighted"
      >
        {{ $t('auth.shell.toSite', { site: $t('brand.name') }) }}
      </NuxtLink>
    </p>
  </main>
</template>
