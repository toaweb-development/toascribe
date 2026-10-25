// Nuxt UI's solid primary button lightens on hover (`hover:bg-primary/75`), and white text on that lighter green is
// about 3:1, under the 4.5:1 that WCAG 1.4.3 asks for in every state. The hover goes one step darker instead, so the text keeps its
// contrast; in dark mode the button is light (primary-400) and goes one step lighter. Only a step of Nuxt UI's own palette.
//
// The same palette step logic holds for every admin colour scheme (utils/admin-colors.ts): the steps are those of whatever palette the
// `primary` role has, and test/admin-colors.test.ts measures them for each scheme.
export default defineAppConfig({
  ui: {
    button: {
      compoundVariants: [
        {
          color: 'primary',
          variant: 'solid',
          class: 'hover:bg-(--ui-color-primary-800) dark:hover:bg-(--ui-color-primary-300)',
        },
      ],
    },
    // The text of a soft primary badge or alert is the primary role on a tint of itself (`bg-primary/10`): primary-700 on that
    // tint is 4.3:1 for the default green, under 4.5:1. One step darker (800) in light mode; dark mode keeps primary-400.
    badge: {
      compoundVariants: [
        {
          color: 'primary',
          variant: 'subtle',
          class: 'text-(color:--ui-color-primary-800) dark:text-(color:--ui-color-primary-400)',
        },
        {
          color: 'primary',
          variant: 'soft',
          class: 'text-(color:--ui-color-primary-800) dark:text-(color:--ui-color-primary-400)',
        },
      ],
    },
    alert: {
      compoundVariants: [
        {
          color: 'primary',
          variant: 'subtle',
          class: 'text-(color:--ui-color-primary-800) dark:text-(color:--ui-color-primary-400)',
        },
        {
          color: 'primary',
          variant: 'soft',
          class: 'text-(color:--ui-color-primary-800) dark:text-(color:--ui-color-primary-400)',
        },
      ],
    },
    // The placeholder of a select («Velg rolle…») is `text-dimmed` in Nuxt UI, which is under 4.5:1 on the field (axe color-contrast).
    // The text of a help line (`text-muted`) is measured for every colour scheme, so the placeholder takes that step.
    select: { slots: { placeholder: 'truncate text-muted' } },
    // The shell is as tall as the window minus the bar across the top, not as the window: the sidebar and the page panel fill
    // the space the dashboard group gives them (Nuxt UI makes both `min-h-svh`).
    dashboardSidebar: { slots: { root: 'min-h-0' } },
    dashboardPanel: { slots: { root: 'min-h-0' } },
  },
})
