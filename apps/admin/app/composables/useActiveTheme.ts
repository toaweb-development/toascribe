import { ActiveTheme } from '@toascribe/shared'

/**
 * The site's active theme, read once in the browser from `/_toascribe/theme` (the site, on the same origin behind the proxy) and
 * kept for the visit. Null until it answers, and when it does not: the editor then offers its defaults (utils/active-theme.ts).
 */
export function useActiveTheme() {
  const theme = useState<ActiveTheme | null>('active-theme', () => null)
  const asked = useState<boolean>('active-theme:asked', () => false)
  onMounted(async () => {
    if (asked.value) return
    asked.value = true
    try {
      theme.value = ActiveTheme.parse(await $fetch('/_toascribe/theme', { timeout: 3000, retry: 0 }))
    } catch {
      theme.value = null
    }
  })
  return theme
}
