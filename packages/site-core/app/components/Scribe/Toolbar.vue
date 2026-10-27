<script setup lang="ts">
// The toolbar on the site for a signed-in person (K-032, WordPress' admin bar): the way to the admin, «Rediger» for the item shown
// when the account may edit its type (the api decides for the item itself), and «Logg ut». Nothing for a visitor. The session is
// read on the server with the page, so a signed-in person never sees the page without it; the page itself is never cached.
const { t } = useI18n()
const auth = useAuth()
const { content } = useContent()

if (auth.session.value.status === 'unknown') {
  await auth.refresh().catch(() => undefined)
}

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
