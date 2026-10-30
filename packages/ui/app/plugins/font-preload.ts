// The admin's main font, Geist (latin, variable), asked for with the page rather than when the stylesheet is read (TAILWIND_STANDARD
// §7): the same hashed file under /_nuxt that tokens/typography.css loads, so `font-src 'self'` holds.
import geistLatin from '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url'

export default defineNuxtPlugin(() => {
  useHead({
    link: [{ rel: 'preload', as: 'font', type: 'font/woff2', href: geistLatin, crossorigin: 'anonymous' }],
  })
})
