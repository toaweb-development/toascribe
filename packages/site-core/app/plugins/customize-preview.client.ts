// The site in «Utseende → Tilpass»' preview frame (M1.5, K-150): the admin posts the choices not saved yet, and this page draws them,
// the same page and build, nothing stored. Only a message from the parent window on the site's own origin is read (the admin is
// served from it, under /admin), and only after it passed CustomizePreviewMessage; the theme's choices are kept to what the theme
// names, as on the server. The new CSS goes into the `<style>` ScribeHead wrote with the response's nonce.
import { activeTheme } from '#toascribe/theme'
import {
  CUSTOMIZE_PREVIEW_READY,
  CustomizePreviewMessage,
  customizationCss,
  themeCustomization,
} from '@toascribe/shared'

export default defineNuxtPlugin(() => {
  if (window.parent === window) return
  const customize = useCustomizeState()
  const settings = useSettings()

  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return
    const parsed = CustomizePreviewMessage.safeParse(event.data)
    if (!parsed.success) return
    const message = parsed.data
    const choices =
      activeTheme === null
        ? { ...message.customization, colors: {}, fonts: {} }
        : themeCustomization(message.customization, activeTheme.settings)
    customize.value = {
      css: customizationCss(choices),
      logo: message.logo === null ? null : { ...message.logo, mime: 'image/*', sizes: [] },
      icon: message.icon === null ? null : { ...message.icon, mime: 'image/*', sizes: [] },
    }
    if (settings.value !== null) settings.value = { ...settings.value, title: message.title, tagline: message.tagline }
  })
  window.parent.postMessage({ type: CUSTOMIZE_PREVIEW_READY }, window.location.origin)
})
