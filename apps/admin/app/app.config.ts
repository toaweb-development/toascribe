// Nuxt UI's solid primary button lightens on hover (`hover:bg-primary/75`), and white text on that lighter green is
// about 3:1, under the 4.5:1 that WCAG 1.4.3 asks for in every state. The hover goes one step darker instead, so the text keeps its
// contrast; in dark mode the button is light (primary-400) and goes one step lighter. Only a step of Nuxt UI's own palette.
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
  },
})
