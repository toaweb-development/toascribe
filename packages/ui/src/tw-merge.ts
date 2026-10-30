// tailwind-merge must know «Blekk»'s own names (M2.1): it knows the t-shirt sizes as font sizes and the Tailwind radii only, so it
// would read `text-body` or `text-card-title` as a colour and drop it next to `text-highlighted`, and keep `rounded-lg` over
// `rounded-card`. Nuxt UI reads this from `appConfig.ui.tv` (app.config.ts); test/tw-merge.test.ts runs it.
export const BLEKK_TW_MERGE = {
  extend: {
    theme: {
      text: ['body', 'page-title', 'card-title', 'figure', 'help', 'badge', 'editor-title'],
      radius: ['field', 'card', 'menu'],
      spacing: ['control', 'control-main'],
    },
  },
}
