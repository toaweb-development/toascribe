/**
 * The name the sign-in screens show: the site's own (`blogname`, as `GET /auth/options` gives it) and, only when that is empty
 * or the API could not be asked, the product's name from i18n. The API trims it; a name of spaces counts as empty here too.
 */
export function displaySiteName(options: { siteName: string } | null | undefined, fallback: string): string {
  const name = options?.siteName.trim() ?? ''
  return name === '' ? fallback : name
}
