<script setup lang="ts">
// «Registrer». When the site does not take registrations the screen says so instead of showing a form that would be refused.
definePageMeta({ middleware: 'auth-screens' })

const { t } = useI18n()
const authApi = useAuthApi()

const { data: options } = await useAsyncData('auth:options', () => authApi.options().catch(() => null))
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
    </template>
  </AuthShell>
</template>
