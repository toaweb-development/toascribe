import type { AdminColorScheme } from '@toascribe/shared'

/** The cookie Nuxt's colour mode module reads in the browser before the page paints (nuxt.config.ts: `colorMode.storage`). */
const COLOR_MODE_COOKIE = 'nuxt-color-mode'
const ONE_YEAR_SECONDS = 31_536_000

/**
 * The admin colour scheme (`preferences.adminColorScheme`): one composable for the shell, which applies it, and for the profile
 * page, which changes it. A scheme is a colour mode (`useColorMode`) and the palettes of Nuxt UI's `primary` and `neutral` roles
 * (`useAppConfig().ui.colors`), mapped in utils/admin-colors.ts.
 *
 * No flash of the wrong scheme on a reload: the preferences are loaded before the page is drawn, so the server draws the
 * palettes already; the colour mode is a cookie that the module's inline script reads before the first paint, and the server
 * writes that cookie itself when the account's scheme and the browser's cookie differ (another device changed it).
 */
export function useAdminColorScheme() {
  const { preferences, update, forget } = useAdminPreferences()
  const colorMode = useColorMode()
  const appConfig = useAppConfig()
  // The palettes the build gave the app, kept before the first scheme is applied, so `default` can put them back.
  const baseColors = useState<Record<string, string>>('admin:base-colors', () => ({ ...appConfig.ui.colors }))

  const scheme = computed<AdminColorScheme>(() => preferences.value?.adminColorScheme ?? 'default')

  /** Puts a scheme on the page now. */
  function apply(next: AdminColorScheme): void {
    Object.assign(appConfig.ui.colors, colorsFor(baseColors.value, next))
    const mode = colorModeFor(next)
    colorMode.preference = mode
    if (import.meta.server) {
      // The module only writes the cookie in the browser. Written here too, the browser's script finds the right mode at once.
      const cookie = useCookie(COLOR_MODE_COOKIE, { maxAge: ONE_YEAR_SECONDS, path: '/', sameSite: 'lax' })
      if (cookie.value !== mode) {
        cookie.value = mode
      }
    }
  }

  /**
   * For the shell layout: applies the scheme now and again whenever the preferences change (the profile page saving a new one),
   * and puts the app's own look back when the shell goes away, so the sign-in screens are not dressed in the last account's colours.
   */
  function follow(): void {
    watch(scheme, apply, { immediate: true })
    if (import.meta.server) {
      return // the server draws one page and never leaves the shell
    }
    onScopeDispose(() => {
      apply('default')
      // The next account to sign in on this tab loads its own preferences.
      forget()
    })
  }

  /** Saves a new scheme. It shows at once: the shell follows the preferences. Throws the ApiRequestError when it could not be saved. */
  async function set(next: AdminColorScheme): Promise<void> {
    await update({ adminColorScheme: next })
  }

  return { scheme, apply, follow, set }
}
