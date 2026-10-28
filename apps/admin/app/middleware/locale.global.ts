// Before every page (M1.8, K-330): the admin's language, from the profile or the site. Global middleware runs before a page's own,
// so the session is asked for here first; the page's middleware then reads the same answer.
export default defineNuxtRouteMiddleware(async () => {
  await useAuth()
    .ensure()
    .catch(() => undefined)
  await useAdminLocale().apply()
})
