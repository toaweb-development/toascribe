<script setup lang="ts">
import { SESSION_COOKIE_NAME } from '@toascribe/shared'

// The toolbar on the site for a signed-in person (K-032, WordPress' admin bar): the way to the admin, «Rediger» for the item shown
// when the account may edit its type (the api decides for the item itself), and «Logg ut». Nothing for a visitor. The session is
// read on the server with the page, so a signed-in person never sees the page without it; the page itself is never cached.
const { t } = useI18n()
const auth = useAuth()
const { content } = useContent()

// A visitor without the session cookie has no session to ask about (on the server the cookie is in the request; in the browser it
// is HttpOnly, so the answer the server gave is in the payload).
const hasSession = import.meta.server
  ? useRequestHeaders(['cookie']).cookie?.includes(`${SESSION_COOKIE_NAME}=`) === true
  : true
if (auth.session.value.status === 'unknown') {
  // Without the cookie the answer is known: nobody. It goes to the browser in the payload, so it does not ask either.
  if (hasSession) await auth.refresh().catch(() => undefined)
  else auth.session.value = { status: 'anonymous' }
}

// Maintenance mode (M1.7): an account that sees the site anyway is told, as WordPress' admin bar does.
const settings = useSettings()
const maintenanceOn = computed(() => settings.value?.maintenance.enabled === true)

const account = computed(() => (auth.session.value.status === 'authenticated' ? auth.session.value.account : undefined))
const editPath = computed(() => {
  const item = content.value
  const held = account.value?.capabilities ?? []
  if (item === undefined) return undefined
  return held.includes(item.type === 'page' ? 'edit_pages' : 'edit_posts')
    ? `/admin/${item.type === 'page' ? 'pages' : 'posts'}/${item.id}`
    : undefined
})
</script>

<template>
  <nav v-if="account" class="scribe-toolbar" :aria-label="t('scribe.toolbar.label')">
    <ul>
      <li>
        <a href="/admin/">{{ t('scribe.toolbar.dashboard') }}</a>
      </li>
      <li v-if="maintenanceOn" class="scribe-toolbar-notice">
        <span role="status">{{ t('scribe.maintenance.notice') }}</span>
      </li>
      <li v-if="editPath">
        <a :href="editPath">{{ t('scribe.toolbar.edit') }}</a>
      </li>
      <li class="scribe-toolbar-account">{{ account.displayName }}</li>
      <li>
        <a href="/admin/logout">{{ t('scribe.toolbar.logout') }}</a>
      </li>
    </ul>
  </nav>
</template>
