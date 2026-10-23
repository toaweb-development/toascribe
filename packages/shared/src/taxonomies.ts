import { z } from 'zod'

// The built-in taxonomies (WordPress `create_initial_taxonomies()`: category and post_tag), which `seedCore()` in
// @toascribe/db writes to the `taxonomy` table once. As with roles, the display name is WordPress' English one in the
// data; the admin translates a built-in taxonomy by its slug.

export const BUILT_IN_TAXONOMIES = ['category', 'post_tag'] as const
export const BuiltInTaxonomy = z.enum(BUILT_IN_TAXONOMIES)
export type BuiltInTaxonomy = z.infer<typeof BuiltInTaxonomy>

export interface DefaultTaxonomy {
  readonly slug: BuiltInTaxonomy
  readonly name: string
  readonly isHierarchical: boolean
  /** The content types it applies to (WordPress `object_type`). */
  readonly contentTypes: readonly string[]
}

export const DEFAULT_TAXONOMIES: readonly DefaultTaxonomy[] = [
  { slug: 'category', name: 'Categories', isHierarchical: true, contentTypes: ['post'] },
  { slug: 'post_tag', name: 'Tags', isHierarchical: false, contentTypes: ['post'] },
]
