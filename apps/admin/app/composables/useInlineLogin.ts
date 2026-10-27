/**
 * Sign in again without leaving the page (K-010): while a screen holds work that is not saved (the editor), a lost session opens a
 * login dialog over it instead of sending the person to the login screen. `hold()` says the screen is there (call it in setup); the
 * auth-redirect plugin then sets `needed` instead of navigating, and the screen opens the dialog.
 */
export function useInlineLogin() {
  const holders = useState('auth:inline-login-holders', () => 0)
  const needed = useState('auth:inline-login-needed', () => false)

  function hold(): void {
    onMounted(() => {
      holders.value += 1
    })
    onBeforeUnmount(() => {
      holders.value = Math.max(0, holders.value - 1)
      needed.value = false
    })
  }

  return { holders, needed, hold }
}
