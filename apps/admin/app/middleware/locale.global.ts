// Before every page (M1.8, K-330): the admin's language, from the profile or the site. Global middleware runs before a page's own,
// so the session is asked for here first; the page's middleware then reads the same answer. Not while the browser takes over the
// server's page: the server set the language already and the i18n module restores it, and an await here would only make the page
// wait longer before it answers to the keyboard.
export default defineNuxtRouteMiddleware(async () => {
  if (import.meta.client && useNuxtApp().isHydrating) return
  await useAuth()
    .ensure()
    .catch(() => undefined)
  await useAdminLocale().apply()
})
