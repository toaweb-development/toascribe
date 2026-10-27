// The theme of the site as a Nuxt module (M1.4). It reads the layers once when Nuxt starts (lib/themes.ts), stops the build on a
// broken theme, and writes two modules:
// - `#toascribe/theme` for the app: the templates and the theme's block views as async components, and the active theme;
// - `#toascribe/active-theme` for the server: what `/_toascribe/theme` gives the admin (heading levels, page templates).
import { resolve } from 'node:path'

import { addTemplate, addTypeTemplate, defineNuxtModule } from 'nuxt/kit'

import { resolveTheme } from '../lib/themes.ts'

const component = (file: string) => `defineAsyncComponent(() => import(${JSON.stringify(file)}))`

export default defineNuxtModule({
  meta: { name: 'toascribe-theme' },
  setup(_options, nuxt) {
    const layers = nuxt.options._layers.map((layer) => ({
      rootDir: layer.config.rootDir,
      srcDir: resolve(layer.config.rootDir, layer.config.srcDir ?? '.'),
    }))
    const theme = resolveTheme(layers)

    const app = addTemplate({
      filename: 'toascribe/theme.mjs',
      getContents: () =>
        [
          "import { defineAsyncComponent } from 'vue'",
          `export const templates = {${[...theme.templates].map(([name, file]) => `\n  ${JSON.stringify(name)}: ${component(file)},`).join('')}\n}`,
          `export const blockViews = new Map([${[...theme.blockViews].map(([type, file]) => `\n  [${JSON.stringify(type)}, ${component(file)}],`).join('')}\n])`,
          `export const activeTheme = ${JSON.stringify(theme.active)}`,
          '',
        ].join('\n'),
    })
    nuxt.options.alias['#toascribe/theme'] = app.dst

    nuxt.options.nitro.virtual ??= {}
    nuxt.options.nitro.virtual['#toascribe/active-theme'] = () => `export default ${JSON.stringify(theme.active)}`

    addTypeTemplate(
      {
        filename: 'types/toascribe-theme.d.ts',
        getContents: () => `declare module '#toascribe/theme' {
  import type { Component } from 'vue'
  import type { ActiveTheme } from '@toascribe/shared'
  export const templates: Readonly<Record<string, Component>>
  export const blockViews: ReadonlyMap<string, Component>
  export const activeTheme: ActiveTheme | null
}
declare module '#toascribe/active-theme' {
  import type { ActiveTheme } from '@toascribe/shared'
  const activeTheme: ActiveTheme | null
  export default activeTheme
}
`,
      },
      { nuxt: true, nitro: true },
    )

    // A new template or block view in development needs the module to read the folders again.
    nuxt.hook('builder:watch', async (event, path) => {
      if (
        (event === 'add' || event === 'unlink') &&
        /(^|\/)(templates\/[^/]+\.vue|blocks\/[^/]+\/View\.vue)$/.test(path)
      ) {
        await nuxt.callHook('restart')
      }
    })
  },
})
