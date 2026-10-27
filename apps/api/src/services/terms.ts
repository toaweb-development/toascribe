// Taxonomies and terms (M1.2; WordPress' edit-tags.php and term functions). Reading needs a capability to edit content; the routes
// check that. Making, changing and deleting terms needs `manage_categories`, checked here as well as at the door. The default category
// («Ukategorisert», the setting `default_category`) can be renamed but not deleted.
import type { Database } from '@toascribe/db'
import { CoreSettings, sanitizeTitle } from '@toascribe/shared'
import type {
  BuiltInTaxonomy,
  CreateTermRequest,
  TaxonomyListResponse,
  TermBulkRequest,
  TermBulkResponse,
  TermItem,
  TermListQuery,
  TermListResponse,
  UpdateTermRequest,
} from '@toascribe/shared'

import type { SessionAuth } from '../lib/auth-context.ts'
import { AppError, ForbiddenError, NotFoundError } from '../lib/errors.ts'
import { inTransaction } from '../repositories/executor.ts'
import type { Executor } from '../repositories/executor.ts'
import { readSettings } from '../repositories/settings.ts'
import {
  countTerms,
  deleteTermMovingItems,
  findTaxonomy,
  findTerm,
  findTermRows,
  insertTerm,
  listTaxonomies,
  listTermPage,
  listTermTree,
  lockTaxonomy,
  nameTaken,
  termAncestorIds,
  uniqueTermSlug,
  updateTerm,
} from '../repositories/terms.ts'
import type { TaxonomyRow, TermRow, TermValues } from '../repositories/terms.ts'
import { flattenTree } from './content.ts'
import type { Auditor, RequestContext } from './support.ts'
import { removeFromMenus } from '@toascribe/db'

export interface TermService {
  taxonomies: (auth: SessionAuth) => Promise<TaxonomyListResponse>
  list: (auth: SessionAuth, tax: BuiltInTaxonomy, query: TermListQuery) => Promise<TermListResponse>
  get: (auth: SessionAuth, tax: BuiltInTaxonomy, id: string) => Promise<TermItem>
  create: (
    auth: SessionAuth,
    tax: BuiltInTaxonomy,
    request: CreateTermRequest,
    ctx: RequestContext,
  ) => Promise<TermItem>
  update: (
    auth: SessionAuth,
    tax: BuiltInTaxonomy,
    id: string,
    request: UpdateTermRequest,
    ctx: RequestContext,
  ) => Promise<TermItem>
  remove: (auth: SessionAuth, tax: BuiltInTaxonomy, id: string, ctx: RequestContext) => Promise<void>
  bulk: (
    auth: SessionAuth,
    tax: BuiltInTaxonomy,
    request: TermBulkRequest,
    ctx: RequestContext,
  ) => Promise<TermBulkResponse>
}

/** The capability that changes terms of the built-in taxonomies (WordPress' `manage_terms`, `edit_terms`, `delete_terms`). */
export const MANAGE_TERMS = 'manage_categories'

/**
 * Reading the terms in the admin needs a capability to edit content, as WordPress' edit-tags.php. Checked here as well as in the
 * route, so `toa term` (which calls the service directly) refuses the same accounts (M1.7 review).
 */
function requireRead(auth: SessionAuth): void {
  if (!auth.capabilities.has('edit_posts') && !auth.capabilities.has('edit_pages')) throw new ForbiddenError()
}

export function createTermService(options: {
  readonly db: Database
  readonly clock: () => Date
  readonly audit: Auditor
  readonly onInvalidSetting?: (key: string) => void
}): TermService {
  const { db, clock, audit } = options

  async function defaultTermId(executor: Executor, tax: TaxonomyRow): Promise<string | null> {
    if (tax.slug !== 'category') {
      return null
    }
    const settings = await readSettings(
      executor,
      CoreSettings.pick({ default_category: true }),
      options.onInvalidSetting,
    )
    return settings.default_category
  }

  async function taxonomyOf(executor: Executor, slug: BuiltInTaxonomy): Promise<TaxonomyRow> {
    const tax = await findTaxonomy(executor, slug)
    if (tax === undefined) {
      throw new NotFoundError()
    }
    return tax
  }

  function toItem(row: TermRow, tax: TaxonomyRow, depth: number, defaultId: string | null): TermItem {
    return {
      id: row.id,
      taxonomy: tax.slug,
      name: row.name,
      slug: row.slug,
      description: row.description,
      parentId: row.parentId,
      count: row.count,
      depth,
      isDefault: row.id === defaultId,
    }
  }

  function requireManage(auth: SessionAuth): void {
    if (!auth.capabilities.has(MANAGE_TERMS)) {
      throw new ForbiddenError()
    }
  }

  async function load(executor: Executor, tax: TaxonomyRow, id: string): Promise<TermItem> {
    const row = await findTerm(executor, tax.id, id)
    if (row === undefined) {
      throw new NotFoundError()
    }
    return toItem(row, tax, 0, await defaultTermId(executor, tax))
  }

  /** The parent a request names: a term of the same hierarchical taxonomy, not the term itself or one below it. */
  async function checkParent(
    executor: Executor,
    tax: TaxonomyRow,
    id: string | null,
    parentId: string | null,
  ): Promise<TermRow | null> {
    if (parentId === null) {
      return null
    }
    if (!tax.isHierarchical) {
      throw new AppError(400, 'invalid_parent', 'Only categories have a parent')
    }
    const parent = await findTerm(executor, tax.id, parentId)
    if (parent === undefined) {
      throw new AppError(400, 'invalid_parent', 'The parent must be a category')
    }
    if (id !== null && (parentId === id || (await termAncestorIds(executor, parentId)).includes(id))) {
      throw new AppError(400, 'invalid_parent', 'A category cannot be its own parent or the parent of its parent')
    }
    return parent
  }

  async function removeIn(
    tx: Executor,
    auth: SessionAuth,
    tax: TaxonomyRow,
    id: string,
    ctx: RequestContext,
  ): Promise<void> {
    await lockTaxonomy(tx, tax.id)
    const row = await findTerm(tx, tax.id, id, { forUpdate: true })
    if (row === undefined) {
      throw new NotFoundError()
    }
    const defaultId = await defaultTermId(tx, tax)
    if (row.id === defaultId) {
      throw new AppError(409, 'default_term', 'The default category can be renamed, not deleted')
    }
    await deleteTermMovingItems(tx, row, defaultId, clock())
    await removeFromMenus(tx, row.id, clock())
    await audit(tx, ctx, {
      actor: { id: auth.account.id, username: auth.account.username },
      action: 'term.deleted',
      objectType: tax.slug,
      objectId: row.id,
      oldValue: { name: row.name, slug: row.slug },
    })
  }

  return {
    async taxonomies() {
      const rows = await listTaxonomies(db)
      const taxonomies = []
      for (const tax of rows) {
        taxonomies.push({
          slug: tax.slug,
          name: tax.name,
          isHierarchical: tax.isHierarchical,
          contentTypes: [...tax.contentTypes],
          defaultTermId: await defaultTermId(db, tax),
        })
      }
      return { taxonomies }
    },

    async list(auth, slug, query) {
      requireRead(auth)
      const tax = await taxonomyOf(db, slug)
      const defaultId = await defaultTermId(db, tax)
      const offset = (query.page - 1) * query.per_page
      const searching = query.search !== undefined && query.search !== ''
      let rows: TermRow[]
      let total: number
      let depths = new Map<string, number>()
      if (tax.isHierarchical && !searching && query.orderby === 'name') {
        const flat = flattenTree(await listTermTree(db, tax.id, query.order))
        total = flat.length
        const slice = flat.slice(offset, offset + query.per_page)
        depths = new Map(slice.map((entry) => [entry.id, entry.depth]))
        const byId = new Map((await findTermRows(db, [...depths.keys()])).map((row) => [row.id, row]))
        rows = slice.flatMap((entry) => {
          const row = byId.get(entry.id)
          return row === undefined ? [] : [row]
        })
      } else {
        ;[rows, total] = await Promise.all([
          listTermPage(db, tax.id, query.search, query.orderby, query.order, query.per_page, offset),
          countTerms(db, tax.id, query.search),
        ])
      }
      return {
        items: rows.map((row) => toItem(row, tax, depths.get(row.id) ?? 0, defaultId)),
        total,
        totalPages: Math.ceil(total / query.per_page),
        page: query.page,
        perPage: query.per_page,
      }
    },

    async get(auth, slug, id) {
      requireRead(auth)
      return load(db, await taxonomyOf(db, slug), id)
    },

    async create(auth, slug, request, ctx) {
      requireManage(auth)
      const tax = await taxonomyOf(db, slug)
      const id = await inTransaction(db, async (tx) => {
        await lockTaxonomy(tx, tax.id)
        const parent = await checkParent(tx, tax, null, request.parentId ?? null)
        if (await nameTaken(tx, tax.id, parent?.id ?? null, request.name, null)) {
          throw new AppError(409, 'term_exists', 'A term with this name already exists here')
        }
        const wanted = sanitizeTitle(request.slug ?? '', '') || sanitizeTitle(request.name, 'term')
        const values: TermValues = {
          name: request.name,
          slug: await uniqueTermSlug(tx, tax.id, wanted, parent?.slug ?? null, null),
          parentId: parent?.id ?? null,
          description: request.description ?? '',
        }
        const created = await insertTerm(tx, tax.id, values, clock())
        await audit(tx, ctx, {
          actor: { id: auth.account.id, username: auth.account.username },
          action: 'term.created',
          objectType: tax.slug,
          objectId: created,
          newValue: { name: values.name, slug: values.slug },
        })
        return created
      })
      return load(db, tax, id)
    },

    async update(auth, slug, id, request, ctx) {
      requireManage(auth)
      const tax = await taxonomyOf(db, slug)
      await inTransaction(db, async (tx) => {
        await lockTaxonomy(tx, tax.id)
        const row = await findTerm(tx, tax.id, id, { forUpdate: true })
        if (row === undefined) {
          throw new NotFoundError()
        }
        const parentId = request.parentId === undefined ? row.parentId : request.parentId
        const parent =
          parentId === row.parentId && parentId !== null
            ? await findTerm(tx, tax.id, parentId)
            : await checkParent(tx, tax, row.id, parentId)
        const name = request.name ?? row.name
        if ((name !== row.name || parentId !== row.parentId) && (await nameTaken(tx, tax.id, parentId, name, row.id))) {
          throw new AppError(409, 'term_exists', 'A term with this name already exists here')
        }
        const changes: { -readonly [K in keyof TermValues]?: TermValues[K] } = {}
        if (name !== row.name) changes.name = name
        if (parentId !== row.parentId) changes.parentId = parentId
        if (request.description !== undefined && request.description !== row.description) {
          changes.description = request.description
        }
        if (request.slug !== undefined) {
          const wanted = sanitizeTitle(request.slug, '') || sanitizeTitle(name, 'term')
          const slugValue = await uniqueTermSlug(tx, tax.id, wanted, parent?.slug ?? null, row.id)
          if (slugValue !== row.slug) changes.slug = slugValue
        }
        if (Object.keys(changes).length === 0) {
          return
        }
        await updateTerm(tx, row.id, changes, clock())
        await audit(tx, ctx, {
          actor: { id: auth.account.id, username: auth.account.username },
          action: 'term.updated',
          objectType: tax.slug,
          objectId: row.id,
          newValue: { fields: Object.keys(changes).sort() },
        })
      })
      return load(db, tax, id)
    },

    async remove(auth, slug, id, ctx) {
      requireManage(auth)
      const tax = await taxonomyOf(db, slug)
      await inTransaction(db, (tx) => removeIn(tx, auth, tax, id, ctx))
    },

    async bulk(auth, slug, request, ctx) {
      requireManage(auth)
      const tax = await taxonomyOf(db, slug)
      return inTransaction(db, async (tx) => {
        const result: TermBulkResponse = { changed: [], skipped: [] }
        for (const id of request.ids) {
          try {
            await tx.transaction((savepoint) => removeIn(savepoint, auth, tax, id, ctx))
            result.changed.push(id)
          } catch (caught) {
            if (caught instanceof AppError && caught.code === 'default_term') {
              result.skipped.push({ id, reason: 'default_term' })
            } else if (caught instanceof NotFoundError) {
              result.skipped.push({ id, reason: 'not_found' })
            } else {
              throw caught
            }
          }
        }
        return result
      })
    },
  }
}
