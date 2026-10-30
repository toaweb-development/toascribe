// @toascribe/ui (M2.1): the admin's design system «Blekk» as a Nuxt layer. The tokens and the fonts are one stylesheet,
// app/assets/theme/blekk.css, that the admin imports into its Tailwind entry (a Tailwind `@theme` must be in the file Tailwind
// builds); Nuxt UI's theme of the shared components is app/app.config.ts, which Nuxt merges into the app's. The public site does not
// extend this layer: a theme brings its own look.
export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@nuxt/eslint'],
  // The fonts are self-hosted from @fontsource-variable (blekk.css). @nuxt/fonts, which Nuxt UI turns on, resolves font names
  // through remote providers (Google and others) by default: off, so no build or page ever asks another host for a font.
  ui: { fonts: false },

  // The contrast check, its report and the tests are TypeScript too: typecheck them with the layer (nuxi typecheck reads only what
  // Nuxt's generated configs include).
  typescript: {
    tsConfig: { include: ['../src/**/*.ts', '../test/**/*.ts'] },
    nodeTsConfig: { include: ['../vitest.config.ts'] },
  },
})
