import { decideSetupRedirect } from '../lib/setup/redirect.ts'
import { installedIsKnown, rememberInstalled } from '../lib/setup/installed.ts'

// Until the site is installed every page of the site and of the admin goes to the setup wizard (M0.4); once it is installed
// none does, and the wizard's own address is a 404. One middleware for both apps (it is in the shared layer): the admin
// has the wizard page (`runtimeConfig.public.hostsSetupWizard`), the site sends visitors there.
//
// - It runs before anything is drawn, on the server for the first request, so the browser is sent with a 302 and never sees
//   the page it was sent away from (no flash).
// - The answer comes from `GET /api/v1/setup/status`, which is open to anyone and says nothing else. It is asked once for a
//   page load; the page payload (`useState`) carries it to the browser, so moving between pages asks nothing. The server
//   remembers "installed" for good (lib/setup/installed.ts) and so asks nothing on an installed site.
// - If the api cannot be asked, the page is shown as it is: the api being down is not a reason to send a visitor to a wizard
//   that cannot work either, and the pages show their own "no contact" state.
// - A setup code in the fragment of the address (`#token=`) is not part of the request and not in `Location`; the browser keeps a
//   fragment across a redirect that has none, so the wizard still gets it.
// - No loop: the wizard page is the one page that is never sent anywhere before the install, and the site's redirect leaves
//   the site for the admin, whose middleware shows the wizard.
// Static files, `/_nuxt/**` and `/api/**` are not Nuxt routes (the proxy sends `/api` to the api, and Nitro serves the assets
// before the router), so this does not touch them.
export default defineNuxtRouteMiddleware(async (to) => {
  // Everything that needs the Nuxt context is taken before the first `await`.
  // The server answered this address with an error page (the wizard's address once the site is installed): the browser takes
  // that page over as it is. Asking again would raise the same error while the app starts, which Nuxt logs as a failure.
  if (import.meta.client && useNuxtApp().payload.error) {
    return
  }
  const state = useState<boolean | undefined>('setup:installed', () => undefined)
  const setupApi = useSetupApi()
  const hostsWizard = useRuntimeConfig().public.hostsSetupWizard

  if (state.value === undefined) {
    if (import.meta.server && installedIsKnown()) {
      state.value = true
    } else {
      try {
        state.value = (await setupApi.status()).installed
      } catch {
        return
      }
      if (import.meta.server && state.value) {
        rememberInstalled()
      }
    }
  }

  const decision = decideSetupRedirect({
    installed: state.value,
    hostsWizard,
    path: to.path,
  })

  switch (decision.kind) {
    case 'none':
      return
    case 'route':
      return navigateTo(decision.to, { replace: true })
    case 'external':
      return navigateTo(decision.href, { external: true })
    case 'not-found':
      return abortNavigation(createError({ statusCode: 404, statusMessage: 'Not Found' }))
  }
})
