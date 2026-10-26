import { z } from 'zod'

import { BuiltInTaxonomy } from './taxonomies.ts'

// Taxonomies and terms (M1.2; PLAN «API-endepunktkart», «Taxonomies»): categories (hierarchical) and tags (flat), as WordPress'
// edit-tags.php and its REST API have them. Reading needs a capability to edit content (`edit_posts` or `edit_pages`); making,
// changing and deleting terms needs `manage_categories` (WordPress' `manage_terms`/`edit_terms`/`delete_terms` for both built-in
// taxonomies). Assigning terms to an item is part of editing the item (WordPress' `assign_terms` is `edit_posts`).

export const TERM_NAME_MAX_LENGTH = 200
export const TERM_DESCRIPTION_MAX_LENGTH = 10_000
export const TERMS_DEFAULT_PER_PAGE = 20
export const TERMS_MAX_PER_PAGE = 100
/** The most tags one item can carry (a guard on the request; WordPress has none). */
export const MAX_TAGS_PER_ITEM = 100
export const MAX_CATEGORIES_PER_ITEM = 100

export const TaxonomyParams = z.object({ tax: BuiltInTaxonomy })
export type TaxonomyParams = z.infer<typeof TaxonomyParams>

export const TermParams = z.object({ tax: BuiltInTaxonomy, id: z.uuid() })
export type TermParams = z.infer<typeof TermParams>

/** A taxonomy as GET /taxonomies lists it. The admin translates the built-in names by slug. */
export const TaxonomyItem = z.object({
  slug: BuiltInTaxonomy,
  name: z.string(),
  isHierarchical: z.boolean(),
  contentTypes: z.array(z.string()),
  /** The id of the default term («Ukategorisert» for categories), which cannot be deleted. */
  defaultTermId: z.uuid().nullable(),
})
export type TaxonomyItem = z.infer<typeof TaxonomyItem>

export const TaxonomyListResponse = z.object({ taxonomies: z.array(TaxonomyItem) })
export type TaxonomyListResponse = z.infer<typeof TaxonomyListResponse>

/** A term on an item: what a list column and an editor need. */
export const TermRef = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
})
export type TermRef = z.infer<typeof TermRef>

export const TERM_ORDER_BY = ['name', 'slug', 'count', 'description'] as const
export const TermOrderBy = z.enum(TERM_ORDER_BY)
export type TermOrderBy = z.infer<typeof TermOrderBy>

/**
 * GET /taxonomies/{tax}/terms. A category list without a search and in name order comes as a tree (each parent before its children,
 * with `depth`), as WordPress' edit-tags.php shows it; `page` and `per_page` cut the flattened tree. `per_page` may be up to 100;
 * the admin's pickers ask for every page.
 */
export const TermListQuery = z.strictObject({
  search: z.string().trim().max(TERM_NAME_MAX_LENGTH).optional(),
  orderby: TermOrderBy.default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  per_page: z.coerce.number().int().min(1).max(TERMS_MAX_PER_PAGE).default(TERMS_DEFAULT_PER_PAGE),
})
export type TermListQuery = z.infer<typeof TermListQuery>
export type TermListQueryInput = z.input<typeof TermListQuery>

export const TermItem = z.object({
  id: z.uuid(),
  taxonomy: BuiltInTaxonomy,
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  parentId: z.uuid().nullable(),
  /** Published items that have the term (WordPress' term count). */
  count: z.int().min(0),
  /** 0 at the top; in a category tree the number of ancestors shown above it. */
  depth: z.int().min(0),
  /** The taxonomy's default term («Ukategorisert»): it can be renamed, not deleted. */
  isDefault: z.boolean(),
})
export type TermItem = z.infer<typeof TermItem>

export const TermListResponse = z.object({
  items: z.array(TermItem),
  total: z.int().min(0),
  totalPages: z.int().min(0),
  page: z.int().min(1),
  perPage: z.int().min(1),
})
export type TermListResponse = z.infer<typeof TermListResponse>

const termFields = {
  name: z.string().trim().min(1).max(TERM_NAME_MAX_LENGTH),
  /** Cleaned like WordPress' `sanitize_title`, and made unique in the taxonomy; empty makes one from the name. */
  slug: z.string().max(1000),
  /** Categories only: the parent category, never the term itself or one below it. */
  parentId: z.uuid().nullable(),
  description: z.string().max(TERM_DESCRIPTION_MAX_LENGTH),
}

/** POST /taxonomies/{tax}/terms. */
export const CreateTermRequest = z.strictObject(termFields).partial({ slug: true, parentId: true, description: true })
export type CreateTermRequest = z.infer<typeof CreateTermRequest>

/** PATCH /taxonomies/{tax}/terms/{id}: any of the fields, at least one. */
export const UpdateTermRequest = z
  .strictObject(termFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Send at least one field' })
export type UpdateTermRequest = z.infer<typeof UpdateTermRequest>

/** POST /taxonomies/{tax}/terms/bulk: WordPress' only bulk action on terms. */
export const TermBulkRequest = z.strictObject({
  action: z.literal('delete'),
  ids: z
    .array(z.uuid())
    .min(1)
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Each term may be named once' }),
})
export type TermBulkRequest = z.infer<typeof TermBulkRequest>

/** `not_found`: no such term in the taxonomy; `default_term`: the default category, which cannot be deleted. */
export const TERM_BULK_SKIP_REASONS = ['not_found', 'default_term'] as const
export const TermBulkResponse = z.object({
  changed: z.array(z.uuid()),
  skipped: z.array(z.object({ id: z.uuid(), reason: z.enum(TERM_BULK_SKIP_REASONS) })),
})
export type TermBulkResponse = z.infer<typeof TermBulkResponse>

/** A tag name as an item takes it: the text between commas, trimmed. */
export const TagName = z.string().trim().min(1).max(TERM_NAME_MAX_LENGTH)

/** WordPress' tag box: names separated by commas (also the Arabic comma), trimmed, empty ones and repeats left out. */
export function splitTagNames(text: string): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const part of text.split(/[,،]/)) {
    const name = part.trim().replace(/\s+/g, ' ')
    if (name !== '' && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase())
      names.push(name.slice(0, TERM_NAME_MAX_LENGTH))
    }
  }
  return names
}
