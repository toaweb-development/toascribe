<script setup lang="ts">
// «Registrer». When the site does not take registrations the screen says so instead of showing a form that would be refused.
definePageMeta({ middleware: 'auth-screens' })

const { t } = useI18n()

const { data: options } = await useAuthOptions()
// Closed only when the API said so: if it could not be asked, the form is shown and the call will say what is wrong.
const closed = computed(() => options.value?.registrationOpen === false)

const heading = computed(() => (closed.value ? t('auth.register.closedHeading') : t('auth.register.heading')))
useSeoMeta({ title: () => t('auth.title', { page: heading.value }) })

async function onSent() {
  await navigateTo({ path: '/login', query: NOTICE_QUERY.registered })
}
</script>

<template>
  <AuthShell :heading="heading">
    <template v-if="closed">
      <AuthMessage kind="info">{{ $t('auth.register.closed') }}</AuthMessage>
    </template>
    <AuthRegister v-else @sent="onSent" />

    <template #links>
      <AuthLink to="/login">{{ $t('auth.links.login') }}</AuthLink>
      <AuthLink v-if="!closed" :to="{ path: '/login', query: { action: 'lostpassword' } }">{{
        $t('auth.links.lost')
      }}</AuthLink>
      <!-- The privacy policy (K-199): a page on the site, outside the admin's address. -->
      <li v-if="options?.privacyPolicyPath">
        <a
          :href="options.privacyPolicyPath"
          class="inline-flex min-h-11 items-center text-sm text-toned underline underline-offset-4 hover:text-highlighted"
          >{{ $t('auth.links.privacy') }}</a
        >
      </li>
    </template>
  </AuthShell>
</template>
