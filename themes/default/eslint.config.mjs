// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

// The templates are named after WordPress' hierarchy (`single`, `page`, `404`), as Nuxt's pages and layouts are after their routes.
// Prettier writes a void element as `<img />`, as in site-core.
export default withNuxt(
  { rules: { 'vue/html-self-closing': ['warn', { html: { void: 'always' } }] } },
  { files: ['app/templates/**/*.vue'], rules: { 'vue/multi-word-component-names': 'off' } },
)
