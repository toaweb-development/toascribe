import activeTheme from '#toascribe/active-theme'
import { customizationCss, PublicCustomizeResponse, SiteCustomization, themeCustomization } from '@toascribe/shared'

/**
 * What «Utseende → Tilpass» set for the active theme (useCustomize, ScribeHead): the CSS for its colours, fonts and «Ekstra CSS», the
 * logo and the icon, through the cache by tag. Only the colours and fonts the theme names are kept, a font only among its choices.
 */
export default defineEventHandler(async (event) => {
  privateAnswer(event)
  if (activeTheme === null) return SiteCustomization.parse({ css: '', logo: null, icon: null })
  const found = PublicCustomizeResponse.parse(
    await cachedFromPublicApi(event, `/customize?theme=${encodeURIComponent(activeTheme.slug)}`),
  )
  return SiteCustomization.parse({
    css: customizationCss(themeCustomization(found.customization, activeTheme.settings)),
    logo: found.logo,
    icon: found.icon,
  })
})
