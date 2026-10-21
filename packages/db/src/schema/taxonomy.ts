// Taxonomies, terms and their links to content (K-130, K-131; WordPress wp_terms, wp_term_taxonomy,
// wp_term_relationships).
import { sql } from 'drizzle-orm'
import { boolean, foreignKey, index, integer, pgTable, primaryKey, text, unique, uuid } from 'drizzle-orm/pg-core'
import type { PgTableExtraConfigValue } from 'drizzle-orm/pg-core'

import { createdAt, id, timestamps } from './columns.ts'
import { content } from './content.ts'

/** A taxonomy: category, post_tag, or one from code, an extension or admin. */
export const taxonomy = pgTable(
  'taxonomy',
  {
    id: id(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    isHierarchical: boolean('is_hierarchical').notNull().default(false),
    /** Content type keys the taxonomy applies to. */
    contentTypes: text('content_types')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [unique('uq_taxonomy_slug').on(t.slug)],
)

/** A term of a taxonomy; hierarchical through parent_id. */
export const term = pgTable(
  'term',
  {
    id: id(),
    taxonomyId: uuid('taxonomy_id').notNull(),
    parentId: uuid('parent_id'),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    // Unique per taxonomy, not per parent: archive URLs (/category/<slug>) resolve by the slug alone, and WordPress
    // gives a child that would clash a suffixed slug. The index also serves «terms of a taxonomy».
    unique('uq_term_taxonomy_id_slug').on(t.taxonomyId, t.slug),
    // A taxonomy's terms go with it.
    foreignKey({ name: 'fk_term_taxonomy_id', columns: [t.taxonomyId], foreignColumns: [taxonomy.id] }).onDelete(
      'cascade',
    ),
    // A deleted parent leaves its children at the top (WordPress moves them to the grandparent; the service does that
    // first, this is the fallback).
    foreignKey({ name: 'fk_term_parent_id', columns: [t.parentId], foreignColumns: [t.id] }).onDelete('set null'),
    index('idx_term_parent_id')
      .on(t.parentId)
      .where(sql`${t.parentId} is not null`),
  ],
)

/** Which terms a content item has. */
export const contentTerm = pgTable(
  'content_term',
  {
    contentId: uuid('content_id').notNull(),
    termId: uuid('term_id').notNull(),
    /** Order of the terms on the item (WordPress term_order). */
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ name: 'pk_content_term', columns: [t.contentId, t.termId] }),
    // Links go with the content ...
    foreignKey({ name: 'fk_content_term_content_id', columns: [t.contentId], foreignColumns: [content.id] }).onDelete(
      'cascade',
    ),
    // ... and with the term (the content stays, without that term).
    foreignKey({ name: 'fk_content_term_term_id', columns: [t.termId], foreignColumns: [term.id] }).onDelete('cascade'),
    // Term archives: the content of one term.
    index('idx_content_term_term_id').on(t.termId),
  ],
)
