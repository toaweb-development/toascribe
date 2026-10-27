import activeTheme from '#toascribe/active-theme'

/**
 * The active theme as the admin's editor needs it (M1.4): the heading levels it offers and the page templates per type. Public:
 * it is what the site's build already shows. 404 when the site was built without a theme.
 */
export default defineEventHandler((event) => {
  if (activeTheme === null) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  setResponseHeader(event, 'cache-control', 'no-cache')
  return activeTheme
})
