import type { AdminLocale } from '@toascribe/shared'

/** The site's language as the api last said it (`GET /auth/options`), kept in the page payload. Empty: not known. */
const SITE_LOCALE_KEY = 'admin:site-locale'

/**
 * The admin's language (M1.8, K-330): the profile's choice, else the site's language, else bokmål. `apply` sets it before a page
 * is drawn (the global middleware) and after the profile changes it, so the server and the browser draw the same language.
 */
export function useAdminLocale() {
  const nuxtApp = useNuxtApp()
  const auth = useAuth()
  const authApi = useAuthApi()
  const siteLocale = useState<string | null>(SITE_LOCALE_KEY, () => null)

  async function apply(): Promise<AdminLocale> {
    if (siteLocale.value === null) {
      siteLocale.value = await authApi
        .options()
        .then((options) => options.locale)
        .catch(() => '')
    }
    const session = auth.session.value
    const own = session.status === 'authenticated' ? session.account.locale : null
    const wanted = pickAdminLocale(own, siteLocale.value)
    if (nuxtApp.$i18n.locale.value !== wanted) await nuxtApp.$i18n.setLocale(wanted)
    return wanted
  }

  return { siteLocale: readonly(siteLocale), apply }
}
