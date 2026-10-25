/**
 * The inline `style` attributes that the admin's server-rendered HTML carries, and nothing else. The CSP has no `'unsafe-inline'`:
 * these are the only strings it lets through in `style-src-attr`, each by its sha256 and with `'unsafe-hashes'` (Tor's decision, M0.5
 * round 1: for styles only, never for a script). Every string is a constant that a Nuxt UI or Reka UI component writes while it is
 * drawn on the server; in the browser the same styles are set through the CSSOM, which the policy allows. The page has no way to add a
 * style attribute of its own.
 *
 * This is the one list. `nuxt.config.ts` builds the directive from it, and two tests hold it to the HTML: `e2e/headers.spec.ts`
 * loads every screen, with the sidebar open and collapsed, and fails on a string that is drawn and not listed and on a listed string
 * that no screen draws; `test/csp-style-attributes.test.ts` fails if `'unsafe-hashes'` is anywhere but `style-src-attr`. A new
 * Nuxt UI or Reka UI version that writes another string therefore fails the end-to-end tests, and a string is removed here as soon
 * as nothing draws it.
 */
export interface StyleAttribute {
  /** The attribute value exactly as the server writes it. */
  value: string
  /** Which component writes it, and where it shows. */
  reason: string
}

export const ADMIN_STYLE_ATTRIBUTES: readonly StyleAttribute[] = [
  {
    value: '--width:15rem;',
    reason:
      'UDashboardSidebar, the root of the open sidebar (layouts/dashboard.vue): its width as a custom property, on every signed-in page.',
  },
  {
    value: '--width:0rem;',
    reason:
      'UDashboardSidebar, the same root while the sidebar is collapsed to its rail (the state is a cookie, so the server draws it).',
  },
  {
    value: 'outline:none;',
    reason:
      'Reka UI RovingFocusGroup, the root of URadioGroup: the colour scheme cards on the profile (profile/Personal.vue). The cards draw their own focus ring.',
  },
  {
    value: 'pointer-events:none;',
    reason:
      'Reka UI SelectValue (the text inside the button of a USelect: the display name on the profile, the role in the bulk change on the users list) and the indicator of the chosen radio (profile/Personal.vue). Presses go to the element underneath.',
  },
  {
    value:
      'position:absolute;border:0;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0, 0, 0, 0);clip-path:inset(50%);white-space:nowrap;word-wrap:normal;top:-1px;left:-1px;',
    reason:
      'Reka UI VisuallyHidden: the native <select aria-hidden> that every USelect inside a form writes beside its button so the form can send the value (the display name on the profile, the bulk role on the users list).',
  },
]
