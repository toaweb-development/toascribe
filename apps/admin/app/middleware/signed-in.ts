// Runs before every page of the admin shell (`definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })`). Someone who is not
// signed in goes to the login screen and comes back to this page after it (`redirectTo`, utils/auth-redirect.ts); so does a
// session that has passed the password but not yet the second factor: the login screen shows the second step for it (M0.3).
// A signed-in person gets their preferences loaded before the page is drawn, so the colour scheme is right on the first paint.
export default defineNuxtRouteMiddleware(async (to) => {
  const baseURL = useRuntimeConfig().app.baseURL
  const auth = useAuth()
  const session = await auth.ensure().catch(() => undefined)

  if (session?.status !== 'authenticated') {
    return navigateTo(loginLocation(to.fullPath, baseURL), { replace: true })
  }
  await useAdminPreferences().ensure()
})
