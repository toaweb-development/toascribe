<script setup lang="ts">
// A page that asks before it logs out, like wp-login.php?action=logout. Without a session there is nothing to ask about.
const { t } = useI18n()
const auth = useAuth()

// The site's name is asked for beside the session, so the page waits for the slower of the two and not for both in turn.
const [session] = await Promise.all([auth.ensure().catch(() => undefined), useAuthOptions()])
if (session?.status !== 'authenticated' && session?.status !== 'mfa_required') {
  await navigateTo({ path: '/login', query: NOTICE_QUERY.loggedOut }, { replace: true })
}

useSeoMeta({ title: () => t('auth.title', { page: t('auth.logout.heading') }) })

async function onLoggedOut() {
  await navigateTo({ path: '/login', query: NOTICE_QUERY.loggedOut })
}
</script>

<template>
  <AuthShell :heading="$t('auth.logout.heading')">
    <AuthLogoutConfirm @logged-out="onLoggedOut" />
  </AuthShell>
</template>
