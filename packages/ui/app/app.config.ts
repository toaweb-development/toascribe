import { BLEKK_TW_MERGE } from '../src/tw-merge'

// «Blekk» (M2.1): Nuxt UI's components dressed in the tokens of app/assets/theme (no colour code here, only the token utilities).
// The admin and the setup wizard use these through Nuxt UI's own components, so one place decides how a button, a field or a card
// looks. Sizes: fields and buttons 40 px (`xs` to `md`), main actions 44 px (`lg`, `xl`): nothing to press under 40 px.
export default defineAppConfig({
  ui: {
    tv: { twMergeConfig: BLEKK_TW_MERGE },
    button: {
      slots: { base: 'font-medium' },
      variants: {
        size: {
          xs: { base: 'min-h-control min-w-control' },
          sm: { base: 'min-h-control min-w-control' },
          md: { base: 'min-h-control px-3.5 gap-2 text-body' },
          lg: { base: 'min-h-control-main px-4 gap-2 text-body' },
          xl: { base: 'min-h-control-main px-5 gap-2 text-body' },
        },
      },
      compoundVariants: [
        // The main action: the accent's fill with white text (4.5:1 and more in both themes, test/contrast.test.ts), not the primary
        // role, which is the accent as text (lighter in the dark theme).
        {
          color: 'primary',
          variant: 'solid',
          class:
            'bg-accent text-on-accent hover:bg-accent/90 active:bg-accent/90 disabled:bg-accent aria-disabled:bg-accent',
        },
        // A filled button of another role: Nuxt UI lightens it to /75 under the pointer, under 4.5:1 for its text; /90 keeps it
        // (test/contrast.test.ts measures it).
        { color: 'success', variant: 'solid', class: 'hover:bg-success/90 active:bg-success/90' },
        { color: 'warning', variant: 'solid', class: 'hover:bg-warning/90 active:bg-warning/90' },
        { color: 'error', variant: 'solid', class: 'hover:bg-error/90 active:bg-error/90' },
        { color: 'info', variant: 'solid', class: 'hover:bg-info/90 active:bg-info/90' },
        // A secondary action: the strong edge (3:1) on the card.
        {
          color: 'neutral',
          variant: 'outline',
          class: 'ring-line-strong text-highlighted bg-surface hover:bg-sunken',
        },
        // A text button: the accent as text, underlined under the pointer.
        { color: 'primary', variant: 'link', class: 'text-accent-text hover:text-accent-hover hover:underline' },
        // Danger: the danger colour as text on the card's edge.
        { color: 'error', variant: 'outline', class: 'ring-line-strong text-danger hover:bg-sunken' },
      ],
      defaultVariants: { size: 'md' },
    },
    input: {
      variants: {
        size: {
          xs: { base: 'min-h-control' },
          sm: { base: 'min-h-control' },
          md: { base: 'min-h-control text-body' },
          lg: { base: 'min-h-control-main text-body' },
        },
        variant: { outline: 'ring-line-strong bg-surface' },
      },
      defaultVariants: { size: 'md' },
    },
    inputNumber: { variants: { size: { md: { base: 'min-h-control text-body' } } } },
    textarea: { variants: { variant: { outline: 'ring-line-strong bg-surface text-body' } } },
    select: {
      slots: { placeholder: 'truncate text-muted' },
      variants: {
        size: { md: { base: 'min-h-control text-body' }, lg: { base: 'min-h-control-main text-body' } },
        variant: { outline: 'ring-line-strong bg-surface' },
      },
      defaultVariants: { size: 'md' },
    },
    selectMenu: {
      slots: { placeholder: 'truncate text-muted' },
      variants: {
        size: { md: { base: 'min-h-control text-body' }, lg: { base: 'min-h-control-main text-body' } },
        variant: { outline: 'ring-line-strong bg-surface' },
      },
      defaultVariants: { size: 'md' },
    },
    checkbox: { slots: { base: 'ring-line-strong' } },
    card: {
      slots: {
        root: 'rounded-card bg-surface ring ring-line',
        header: 'text-card-title font-semibold text-highlighted',
      },
    },
    badge: { slots: { base: 'rounded-full text-badge font-medium' } },
    alert: { slots: { root: 'rounded-card' } },
    modal: { slots: { content: 'rounded-card' } },
    navigationMenu: { slots: { link: 'rounded-menu' } },
    dropdownMenu: { slots: { item: 'rounded-menu' } },
  },
})
