// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

// The templates are named after WordPress' hierarchy (`single`, `page`, `404`), as Nuxt's pages and layouts are after their routes.
export default withNuxt({ files: ['app/templates/**/*.vue'], rules: { 'vue/multi-word-component-names': 'off' } })
