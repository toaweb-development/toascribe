import type { AdminLocale, AuthOptionsResponse } from '@toascribe/shared'

import { AUTH_OPTIONS_KEY } from './useAuthOptions'

/**
 * The admin's language (M1.8, K-330): the profile's choice, else the site's language, else bokmål. `apply` sets it before a page
 * is drawn (the global middleware) and after the profile changes it, so the server and the browser draw the same language.
 * The site's language comes with `GET /auth/options`, kept in the payload under the key the sign-in pages read
 * (useAuthOptions), so a page asks for it once. A failed answer is not kept: the next page asks again.
 */
export function useAdminLocale() {
  const nuxtApp = useNuxtApp()
  const auth = useAuth()
  const authApi = useAuthApi()

  async function siteLocale(): Promise<string | undefined> {
    const kept = nuxtApp.payload.data[AUTH_OPTIONS_KEY] as AuthOptionsResponse | null | undefined
    if (kept) return kept.locale
    const fetched = await authApi.options().catch(() => undefined)
    if (fetched !== undefined) nuxtApp.payload.data[AUTH_OPTIONS_KEY] = fetched
    return fetched?.locale
  }

  async function apply(): Promise<AdminLocale> {
    const session = auth.session.value
    const own = session.status === 'authenticated' ? session.account.locale : null
    const wanted = pickAdminLocale(own, own === null ? await siteLocale() : undefined)
    if (nuxtApp.$i18n.locale.value !== wanted) await nuxtApp.$i18n.setLocale(wanted)
    return wanted
  }

  return { apply }
}
