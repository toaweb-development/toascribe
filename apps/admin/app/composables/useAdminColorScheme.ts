import type { AdminColorScheme } from '@toascribe/shared'

/** The cookie Nuxt's colour mode module reads in the browser before the page paints (nuxt.config.ts: `colorMode.storage`). */
const COLOR_MODE_COOKIE = 'nuxt-color-mode'
const ONE_YEAR_SECONDS = 31_536_000

/**
 * The admin's theme (`preferences.adminColorScheme`, M2.1 «Blekk»): the system's light or dark, always light, or always dark. One
 * composable for the shell, which applies it, and for the profile page, which changes it. The colours are «Blekk»'s tokens
 * (packages/ui), which `.dark` points at the dark set.
 *
 * No flash of the wrong theme on a reload: the preferences are loaded before the page is drawn, and the colour mode is a cookie that
 * the module's inline script reads before the first paint; the server writes that cookie itself when the account's theme and the
 * browser's cookie differ (another device changed it).
 */
export function useAdminColorScheme() {
  const { preferences, update, forget } = useAdminPreferences()
  const colorMode = useColorMode()

  const scheme = computed<AdminColorScheme>(() => preferences.value?.adminColorScheme ?? 'system')

  /** Puts a theme on the page now. */
  function apply(next: AdminColorScheme): void {
    colorMode.preference = next
    if (import.meta.server) {
      // The module only writes the cookie in the browser. Written here too, the browser's script finds the right mode at once.
      const cookie = useCookie(COLOR_MODE_COOKIE, { maxAge: ONE_YEAR_SECONDS, path: '/', sameSite: 'lax' })
      if (cookie.value !== next) {
        cookie.value = next
      }
    }
  }

  /**
   * For the shell layout: applies the theme now and again whenever the preferences change (the profile page saving a new one), and
   * goes back to the system's when the shell goes away, so the sign-in screens are not dressed in the last account's choice.
   */
  function follow(): void {
    watch(scheme, apply, { immediate: true })
    if (import.meta.server) {
      return // the server draws one page and never leaves the shell
    }
    onScopeDispose(() => {
      apply('system')
      // The next account to sign in on this tab loads its own preferences.
      forget()
    })
  }

  /** Saves a new theme. It shows at once: the shell follows the preferences. Throws the ApiRequestError when it could not be saved. */
  async function set(next: AdminColorScheme): Promise<void> {
    await update({ adminColorScheme: next })
  }

  return { scheme, apply, follow, set }
}
