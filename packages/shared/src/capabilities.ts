import { z } from 'zod'

// The five built-in roles and their capabilities, as WordPress 7.1.3 stores them after `populate_roles()`
// (wp-admin/includes/schema.php, steps 160 to 300), with one change: the editor has no `unfiltered_html` (Tor, M0.3).
// Names and lists are WordPress', so documentation and habits carry over (PLAN «Roller og capabilities»). `seedCore()` in @toascribe/db writes them to the `role` table once; after that
// the rows are the truth and an administrator may change them.
//
// Not here, on purpose:
// - The deprecated `level_0` ... `level_10` capabilities that WordPress still stores for old plugins. Nothing in
//   toascribe reads them, and a WXR import does not carry roles (docs/DATAMODEL.md «Deviations from PLAN»).
// - Meta capabilities (`edit_post`, `delete_post`, `read_post`, `edit_user`, `edit_comment`, `assign_term`, ...).
//   WordPress never stores them: `map_meta_cap()` resolves them per object to the stored ones below. toascribe does
//   the same in code (M0.3 for accounts, M0.5 for content).
// - Multisite capabilities (`manage_network`, `manage_sites`, ...): toascribe has no multisite (PLAN «Funksjonskart»).
//
// Extensions and administrators may add capabilities of their own (PLAN), so a role's `capabilities` column is not
// limited to this list: `Capability` validates the core names only.

/** Every capability a built-in role stores, in the order WordPress adds them to the administrator. 50 names. */
export const CAPABILITIES = [
  // populate_roles_160
  'switch_themes',
  'edit_themes',
  'activate_plugins',
  'edit_plugins',
  'edit_users',
  'edit_files',
  'manage_options',
  'moderate_comments',
  'manage_categories',
  'manage_links',
  'upload_files',
  'import',
  'unfiltered_html',
  'edit_posts',
  'edit_others_posts',
  'edit_published_posts',
  'publish_posts',
  'edit_pages',
  'read',
  // populate_roles_210
  'edit_others_pages',
  'edit_published_pages',
  'publish_pages',
  'delete_pages',
  'delete_others_pages',
  'delete_published_pages',
  'delete_posts',
  'delete_others_posts',
  'delete_published_posts',
  'delete_private_posts',
  'edit_private_posts',
  'read_private_posts',
  'delete_private_pages',
  'edit_private_pages',
  'read_private_pages',
  'delete_users',
  'create_users',
  // populate_roles_230 to populate_roles_280
  'unfiltered_upload',
  'edit_dashboard',
  'update_plugins',
  'delete_plugins',
  'install_plugins',
  'update_themes',
  'install_themes',
  // populate_roles_300
  'update_core',
  'list_users',
  'remove_users',
  'promote_users',
  'edit_theme_options',
  'delete_themes',
  'export',
] as const
export const Capability = z.enum(CAPABILITIES)
export type Capability = z.infer<typeof Capability>

/** The slugs of the five built-in roles (WordPress role names). */
export const BUILT_IN_ROLES = ['administrator', 'editor', 'author', 'contributor', 'subscriber'] as const
export const BuiltInRole = z.enum(BUILT_IN_ROLES)
export type BuiltInRole = z.infer<typeof BuiltInRole>

export interface RoleDefinition {
  readonly slug: BuiltInRole
  /** WordPress' English display name. Kept in English in the data; the admin translates built-in roles by slug. */
  readonly name: string
  readonly capabilities: readonly Capability[]
}

/** The capabilities WordPress' step 210 gives both the administrator and the editor. */
const EDITOR_210 = [
  'edit_others_pages',
  'edit_published_pages',
  'publish_pages',
  'delete_pages',
  'delete_others_pages',
  'delete_published_pages',
  'delete_posts',
  'delete_others_posts',
  'delete_published_posts',
  'delete_private_posts',
  'edit_private_posts',
  'read_private_posts',
  'delete_private_pages',
  'edit_private_pages',
  'read_private_pages',
] as const satisfies readonly Capability[]

/**
 * Capabilities a role must not have to be «Standard rolle for nye brukere» (anyone who fills in the registration form gets it): the
 * ones that manage the site, its users or its code, and raw HTML, which runs with the page's rights on the public site. The settings
 * screen refuses such a role, and registration refuses to give one (a role can change after it was chosen).
 */
export const REGISTRATION_FORBIDDEN_CAPABILITIES: readonly string[] = [
  'manage_options',
  'promote_users',
  'edit_users',
  'create_users',
  'delete_users',
  'remove_users',
  'unfiltered_html',
  'unfiltered_upload',
  'edit_theme_options',
  'switch_themes',
  'edit_themes',
  'install_themes',
  'update_themes',
  'delete_themes',
  'activate_plugins',
  'edit_plugins',
  'install_plugins',
  'update_plugins',
  'delete_plugins',
  'edit_files',
  'update_core',
  'import',
]

/** Whether a role may be given to anyone who registers: not the administrator, and none of REGISTRATION_FORBIDDEN_CAPABILITIES. */
export function isRegistrationRole(role: { readonly slug: string; readonly capabilities: readonly string[] }): boolean {
  return (
    role.slug !== 'administrator' &&
    !role.capabilities.some((capability) => REGISTRATION_FORBIDDEN_CAPABILITIES.includes(capability))
  )
}

/** The built-in roles with WordPress' capability lists, the editor without unfiltered_html: 50, 25, 7, 3 and 1 names. */
export const DEFAULT_ROLES: readonly RoleDefinition[] = [
  { slug: 'administrator', name: 'Administrator', capabilities: CAPABILITIES },
  {
    slug: 'editor',
    name: 'Editor',
    capabilities: [
      'moderate_comments',
      'manage_categories',
      'manage_links',
      'upload_files',
      // WordPress also gives the editor unfiltered_html. toascribe does not (Tor, M0.3): raw HTML and scripts in content
      // are the administrator's right, who may grant it to a role. Migration 0003 takes it from v0.2.0's editor row.
      'edit_posts',
      'edit_others_posts',
      'edit_published_posts',
      'publish_posts',
      'edit_pages',
      'read',
      ...EDITOR_210,
    ],
  },
  {
    slug: 'author',
    name: 'Author',
    capabilities: [
      'upload_files',
      'edit_posts',
      'edit_published_posts',
      'publish_posts',
      'read',
      'delete_posts',
      'delete_published_posts',
    ],
  },
  { slug: 'contributor', name: 'Contributor', capabilities: ['edit_posts', 'read', 'delete_posts'] },
  { slug: 'subscriber', name: 'Subscriber', capabilities: ['read'] },
]
