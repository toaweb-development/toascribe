// `toa post`, `toa term` and `toa menu` (M1.7, K-263), as WP-CLI's: list, get, create, update and delete, through the api's own
// services (cli/src/services.ts) as the account named by --user. Every request is checked with the shared schema the route uses,
// then by the service, so a command is refused where the api refuses. --format table|json.
import { textToParagraphs } from '@toascribe/blocks'
import {
  BuiltInTaxonomy,
  ContentListQuery,
  CreateContentRequest,
  CreateMenuRequest,
  CreateTermRequest,
  TermListQuery,
  UpdateContentRequest,
  UpdateMenuRequest,
  UpdateTermRequest,
} from '@toascribe/shared'
import { z } from 'zod'

import { UsageError, invalidInput, parseFlags, usageResult } from '../kit.ts'
import type { CommandOptions } from '../options.ts'
import type { CliResult } from '../result.ts'
import { Format, render, renderOne, takeArgument, withServices } from '../services.ts'
import { MENU_USAGE, POST_USAGE, TERM_USAGE } from '../usage.ts'

const Id = z.uuid()
const ok = (stdout: string): CliResult => ({ code: 0, stdout, stderr: '' })

/** The flags shared by every action, and the action's own. */
function flagsOf(args: readonly string[], own: Readonly<Record<string, 'string' | 'boolean'>>) {
  const flags = parseFlags(args, { user: 'string', format: 'string', ...own })
  const format = Format.safeParse(flags['format'] ?? 'table')
  if (!format.success) throw new UsageError('--format is table or json.')
  const text = (name: string) => (typeof flags[name] === 'string' ? flags[name] : undefined)
  return { flags, format: format.data, user: text('user'), text }
}

/** Fields only when given: a flag that is not there is not sent. */
function given(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
}

/** --content (plain text as paragraphs) or --blocks (the block JSON), never both. */
function blocksOf(text: (name: string) => string | undefined): unknown[] | undefined {
  const content = text('content')
  const blocks = text('blocks')
  if (content !== undefined && blocks !== undefined) throw new UsageError('Give --content or --blocks, not both.')
  if (content !== undefined) return textToParagraphs(content)
  if (blocks === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(blocks)
  } catch {
    throw new UsageError('--blocks is not JSON.')
  }
  if (!Array.isArray(parsed)) throw new UsageError('--blocks is a JSON array of blocks.')
  return parsed as unknown[]
}

function needId(id: string | undefined): string {
  if (id === undefined || !Id.safeParse(id).success) throw new UsageError('Give the id (a UUID) after the action.')
  return id
}

const POST_FIELDS = {
  title: 'string',
  slug: 'string',
  status: 'string',
  excerpt: 'string',
  content: 'string',
  blocks: 'string',
} as const

/** `toa post list|get|create|update|delete`. */
export async function post(args: readonly string[], options: CommandOptions = {}): Promise<CliResult> {
  const [action, ...rest] = args
  try {
    switch (action) {
      case 'list': {
        const { format, user, text } = flagsOf(rest, {
          type: 'string',
          status: 'string',
          search: 'string',
          page: 'string',
          'per-page': 'string',
        })
        const query = ContentListQuery.parse(
          given({
            type: text('type') ?? 'post',
            status: text('status'),
            search: text('search'),
            page: text('page'),
            per_page: text('per-page'),
          }),
        )
        return await withServices(options, 'post list', user, async ({ services, auth }) => {
          const list = await services.content.list(auth, query)
          return ok(render(list.items, ['id', 'title', 'slug', 'status', 'publishedAt'], format))
        })
      }
      case 'get': {
        const [id, flagArgs] = takeArgument(rest)
        const { format, user } = flagsOf(flagArgs, {})
        const target = needId(id)
        return await withServices(options, 'post get', user, async ({ services, auth }) =>
          ok(renderOne(await services.content.get(auth, target), format)),
        )
      }
      case 'create': {
        const { format, user, text } = flagsOf(rest, { type: 'string', ...POST_FIELDS })
        const request = CreateContentRequest.parse(
          given({
            type: text('type') ?? 'post',
            title: text('title'),
            slug: text('slug'),
            status: text('status'),
            excerpt: text('excerpt'),
            blocks: blocksOf(text),
          }),
        )
        return await withServices(options, 'post create', user, async ({ services, auth, ctx }) => {
          const created = await services.content.create(auth, request, ctx)
          return ok(
            format === 'json' ? `${JSON.stringify(created, null, 2)}\n` : `Created ${created.type} ${created.id}.\n`,
          )
        })
      }
      case 'update': {
        const [id, flagArgs] = takeArgument(rest)
        const { format, user, text } = flagsOf(flagArgs, POST_FIELDS)
        const target = needId(id)
        const request = UpdateContentRequest.parse(
          given({
            title: text('title'),
            slug: text('slug'),
            status: text('status'),
            excerpt: text('excerpt'),
            blocks: blocksOf(text),
          }),
        )
        return await withServices(options, 'post update', user, async ({ services, auth, ctx }) => {
          const updated = await services.content.update(auth, target, request, ctx)
          return ok(
            format === 'json' ? `${JSON.stringify(updated, null, 2)}\n` : `Updated ${updated.type} ${updated.id}.\n`,
          )
        })
      }
      case 'delete': {
        const [id, flagArgs] = takeArgument(rest)
        const { user, flags } = flagsOf(flagArgs, { force: 'boolean' })
        const target = needId(id)
        // As WP-CLI: to the trash, or for good with --force.
        return await withServices(options, 'post delete', user, async ({ services, auth, ctx }) => {
          if (flags['force'] === true) {
            // As WP-CLI's --force: past the trash. The api deletes only from the trash, so it goes there first.
            const item = await services.content.get(auth, target)
            if (item.status !== 'trash') await services.content.trash(auth, target, ctx)
            await services.content.remove(auth, target, ctx)
            return ok(`Deleted ${target} for good.\n`)
          }
          await services.content.trash(auth, target, ctx)
          return ok(`Moved ${target} to the trash.\n`)
        })
      }
      default:
        throw new UsageError('Say list, get, create, update or delete.')
    }
  } catch (err) {
    if (err instanceof UsageError) return usageResult(err.message, POST_USAGE)
    if (err instanceof z.ZodError) return invalidInput(zodFields(err))
    throw err
  }
}

const TERM_FIELDS = { name: 'string', slug: 'string', parent: 'string', description: 'string' } as const

function taxonomyOf(value: string | undefined): BuiltInTaxonomy {
  const parsed = BuiltInTaxonomy.safeParse(value)
  if (!parsed.success) throw new UsageError('Give the taxonomy (category or post_tag) after the action.')
  return parsed.data
}

/** `toa term list|get|create|update|delete <taxonomy>`. */
export async function term(args: readonly string[], options: CommandOptions = {}): Promise<CliResult> {
  const [action, ...rest] = args
  try {
    const [taxonomyArg, afterTaxonomy] = takeArgument(rest)
    const tax = action === undefined ? 'category' : taxonomyOf(taxonomyArg)
    switch (action) {
      case 'list': {
        const { format, user, text } = flagsOf(afterTaxonomy, {
          search: 'string',
          page: 'string',
          'per-page': 'string',
        })
        const query = TermListQuery.parse(
          given({ search: text('search'), page: text('page'), per_page: text('per-page') }),
        )
        return await withServices(options, 'term list', user, async ({ services, auth }) => {
          const list = await services.terms.list(auth, tax, query)
          return ok(render(list.items, ['id', 'name', 'slug', 'parentId', 'count'], format))
        })
      }
      case 'get': {
        const [id, flagArgs] = takeArgument(afterTaxonomy)
        const { format, user } = flagsOf(flagArgs, {})
        const target = needId(id)
        return await withServices(options, 'term get', user, async ({ services, auth }) =>
          ok(renderOne(await services.terms.get(auth, tax, target), format)),
        )
      }
      case 'create': {
        const { format, user, text } = flagsOf(afterTaxonomy, TERM_FIELDS)
        const request = CreateTermRequest.parse(
          given({ name: text('name'), slug: text('slug'), parentId: text('parent'), description: text('description') }),
        )
        return await withServices(options, 'term create', user, async ({ services, auth, ctx }) => {
          const created = await services.terms.create(auth, tax, request, ctx)
          return ok(format === 'json' ? `${JSON.stringify(created, null, 2)}\n` : `Created ${tax} ${created.id}.\n`)
        })
      }
      case 'update': {
        const [id, flagArgs] = takeArgument(afterTaxonomy)
        const { format, user, text } = flagsOf(flagArgs, TERM_FIELDS)
        const target = needId(id)
        const request = UpdateTermRequest.parse(
          given({ name: text('name'), slug: text('slug'), parentId: text('parent'), description: text('description') }),
        )
        return await withServices(options, 'term update', user, async ({ services, auth, ctx }) => {
          const updated = await services.terms.update(auth, tax, target, request, ctx)
          return ok(format === 'json' ? `${JSON.stringify(updated, null, 2)}\n` : `Updated ${tax} ${updated.id}.\n`)
        })
      }
      case 'delete': {
        const [id, flagArgs] = takeArgument(afterTaxonomy)
        const { user } = flagsOf(flagArgs, {})
        const target = needId(id)
        return await withServices(options, 'term delete', user, async ({ services, auth, ctx }) => {
          await services.terms.remove(auth, tax, target, ctx)
          return ok(`Deleted ${tax} ${target}.\n`)
        })
      }
      default:
        throw new UsageError('Say list, get, create, update or delete, then the taxonomy.')
    }
  } catch (err) {
    if (err instanceof UsageError) return usageResult(err.message, TERM_USAGE)
    if (err instanceof z.ZodError) return invalidInput(zodFields(err))
    throw err
  }
}

/** `toa menu list|get|create|update|delete`. The items are edited in «Utseende → Menyer»; update takes --items as JSON. */
export async function menu(args: readonly string[], options: CommandOptions = {}): Promise<CliResult> {
  const [action, ...rest] = args
  try {
    switch (action) {
      case 'list': {
        const { format, user } = flagsOf(rest, {})
        return await withServices(options, 'menu list', user, async ({ services, auth }) =>
          ok(render((await services.appearance.menus(auth)).items, ['id', 'name', 'slug', 'count'], format)),
        )
      }
      case 'get': {
        const [id, flagArgs] = takeArgument(rest)
        const { format, user } = flagsOf(flagArgs, {})
        const target = needId(id)
        return await withServices(options, 'menu get', user, async ({ services, auth }) => {
          const found = await services.appearance.menu(auth, target)
          return ok(renderOne({ id: found.id, name: found.name, slug: found.slug, items: found.items }, format))
        })
      }
      case 'create': {
        const { format, user, text } = flagsOf(rest, { name: 'string' })
        const request = CreateMenuRequest.parse(given({ name: text('name') }))
        return await withServices(options, 'menu create', user, async ({ services, auth, ctx }) => {
          const created = await services.appearance.createMenu(auth, request, ctx)
          return ok(format === 'json' ? `${JSON.stringify(created, null, 2)}\n` : `Created menu ${created.id}.\n`)
        })
      }
      case 'update': {
        const [id, flagArgs] = takeArgument(rest)
        const { format, user, text } = flagsOf(flagArgs, { name: 'string', items: 'string' })
        const target = needId(id)
        let items: unknown
        const itemsText = text('items')
        if (itemsText !== undefined) {
          try {
            items = JSON.parse(itemsText)
          } catch {
            throw new UsageError('--items is not JSON.')
          }
        }
        const request = UpdateMenuRequest.parse(given({ name: text('name'), items }))
        return await withServices(options, 'menu update', user, async ({ services, auth, ctx }) => {
          const updated = await services.appearance.updateMenu(auth, target, request, ctx)
          return ok(format === 'json' ? `${JSON.stringify(updated, null, 2)}\n` : `Updated menu ${updated.id}.\n`)
        })
      }
      case 'delete': {
        const [id, flagArgs] = takeArgument(rest)
        const { user } = flagsOf(flagArgs, {})
        const target = needId(id)
        return await withServices(options, 'menu delete', user, async ({ services, auth, ctx }) => {
          await services.appearance.deleteMenu(auth, target, ctx)
          return ok(`Deleted menu ${target}.\n`)
        })
      }
      default:
        throw new UsageError('Say list, get, create, update or delete.')
    }
  } catch (err) {
    if (err instanceof UsageError) return usageResult(err.message, MENU_USAGE)
    if (err instanceof z.ZodError) return invalidInput(zodFields(err))
    throw err
  }
}

/** A refused request, by the fields the schema named (never a value). */
export function zodFields(error: z.ZodError): string {
  const fields = [...new Set(error.issues.map((issue) => issue.path.join('.') || '(input)'))]
  return `Invalid input: ${fields.join(', ')}.`
}
