import type { AuthOptionsResponse } from '@toascribe/shared'

/** One key for the page that asks and the shell that reads: the answer travels in the page payload, so nothing is asked twice. */
const AUTH_OPTIONS_KEY = 'auth:options'

/**
 * What the sign-in screens need before anyone is signed in: whether to offer «Registrer», and the site's name. Every sign-in
 * page awaits this in setup, so the server renders the right name and the browser takes it from the payload (no flash of the
 * fallback, no layout shift). If the API cannot be asked the data is null, and the screens use their fallbacks.
 */
export function useAuthOptions() {
  const authApi = useAuthApi()
  return useAsyncData<AuthOptionsResponse | null>(AUTH_OPTIONS_KEY, () => authApi.options().catch(() => null))
}

/** The name of the site for the shell and the logout question. Reads what a page has fetched; it asks for nothing itself. */
export function useSiteName() {
  const { t } = useI18n()
  const { data } = useNuxtData<AuthOptionsResponse | null>(AUTH_OPTIONS_KEY)
  return computed(() => displaySiteName(data.value, t('brand.name')))
}
