// The API said the session is gone (401), from a call that was not about signing in: send the person to the login screen,
// and bring them back to this page afterwards. Browser only; the server never changes anything.
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
      await navigateTo(loginLocation(current.fullPath, baseURL))
    })
  })
})
