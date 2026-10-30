// The admin's own adjustments to Nuxt UI. The look («Blekk»: colours, fonts, sizes of the shared components) is the layer
// @toascribe/ui (packages/ui/app/app.config.ts), which Nuxt merges under this file.
export default defineAppConfig({
  ui: {
    // The shell is as tall as the window minus the bar across the top, not as the window: the sidebar and the page panel fill
    // the space the dashboard group gives them (Nuxt UI makes both `min-h-svh`).
    dashboardSidebar: { slots: { root: 'min-h-0' } },
    dashboardPanel: { slots: { root: 'min-h-0' } },
  },
})
