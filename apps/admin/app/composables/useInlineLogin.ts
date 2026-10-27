/**
 * Sign in again without leaving the page (K-010): while a screen holds work that is not saved (the editor), a lost session opens a
 * login dialog over it instead of sending the person to the login screen. `hold()` says the screen is there (call it in setup); the
 * auth-redirect plugin then sets `needed` instead of navigating, and the screen opens the dialog.
 */
export function useInlineLogin() {
  const holders = useState('auth:inline-login-holders', () => 0)
  const needed = useState('auth:inline-login-needed', () => false)
  /** The path of the screen that holds: a 401 of another page (the next one, loading while this one is still mounted) redirects. */
  const path = useState<string | null>('auth:inline-login-path', () => null)

  function hold(): void {
    const route = useRoute()
    onMounted(() => {
      holders.value += 1
      path.value = route.path
    })
    onBeforeUnmount(() => {
      holders.value = Math.max(0, holders.value - 1)
      if (holders.value === 0) path.value = null
      needed.value = false
    })
  }

  return { holders, needed, path, hold }
}
