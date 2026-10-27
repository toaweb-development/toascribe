// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

// The core components write plain form fields (themes style them), and Prettier writes a void element as `<input />`.
export default withNuxt(
  { rules: { 'vue/html-self-closing': ['warn', { html: { void: 'always' } }] } },
  // The fixtures are themes: their templates are named after WordPress' hierarchy.
  { files: ['test/fixtures/**/*.vue'], rules: { 'vue/multi-word-component-names': 'off' } },
)
