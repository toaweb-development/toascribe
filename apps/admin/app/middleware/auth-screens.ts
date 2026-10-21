// Runs before the sign-in pages (/login and /register). It does what wp-login.php does before it shows anything:
// - `?action=register` and `?action=logout` are the pages /register and /logout (the addresses of wp-login.php keep working);
// - someone who is already signed in has no use for the login or register form: they go on to where they were headed.
// The reset, set-password and confirm-e-mail links work with a session open, and the logout page is for a signed-in person.
export default defineNuxtRouteMiddleware(async (to) => {
  const auth = useAuth()
  const baseURL = useRuntimeConfig().app.baseURL

  if (to.path === '/login') {
    const action = loginAction(to.query.action)
    // The notice and the target in the query stay; `action` and the fragment go.
    const query = { ...to.query }
    delete query.action
    if (action === 'register') {
      return navigateTo({ path: '/register', query }, { replace: true })
    }
    if (action === 'logout') {
      return navigateTo({ path: '/logout', query }, { replace: true })
    }
    if (allowsSession(action)) {
      return
    }
  }

  const session = await auth.ensure().catch(() => undefined)
  if (session?.status === 'authenticated') {
    const target = redirectTarget(redirectFromQuery(to.query), baseURL)
    return target.kind === 'route'
      ? navigateTo(target.to, { replace: true })
      : navigateTo(target.href, { external: true })
  }
})
