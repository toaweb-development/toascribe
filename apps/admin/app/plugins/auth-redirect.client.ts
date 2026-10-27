// The API said the session is gone (401), from a call that was not about signing in: send the person to the login screen,
// and bring them back to this page afterwards; a screen with unsaved work opens a login dialog instead (useInlineLogin). Browser
// only; the server never changes anything.
export default defineNuxtPlugin((nuxtApp) => {
  const baseURL = useRuntimeConfig().app.baseURL
  const router = useRouter()

  nuxtApp.hook('api:unauthorized', async () => {
    await nuxtApp.runWithContext(async () => {
      useAuth().invalidate()
      const current = router.currentRoute.value
      if (['/login', '/register', '/logout'].includes(current.path)) {
        return // the sign-in screens deal with their own 401s
      }
      // A screen with work that is not saved (the editor) signs in again in a dialog over itself (K-010, useInlineLogin).
      const inline = useInlineLogin()
      if (inline.holders.value > 0 && inline.path.value === current.path) {
        inline.needed.value = true
        return
      }
      await navigateTo(loginLocation(current.fullPath, baseURL))
    })
  })
})
