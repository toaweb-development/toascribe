import { OpenAPIHono, z } from '@hono/zod-openapi'
import {
  ApiError,
  CreateGlobalSetRequest,
  CreateMenuRequest,
  CustomizeResponse,
  EmbedPreviewRequest,
  EmbedPreviewResponse,
  GlobalSetChoicesResponse,
  GlobalSetDetail,
  GlobalSetListResponse,
  MenuDetail,
  MenuListResponse,
  MenuLocationsResponse,
  PublicCustomizeResponse,
  PublicGlobalSetResponse,
  PublicMenuResponse,
  UpdateCustomizeRequest,
  UpdateGlobalSetRequest,
  UpdateMenuLocationsRequest,
} from '@toascribe/shared'

import { getClientIp } from '../lib/client-ip.ts'
import type { AppEnv } from '../lib/env.ts'
import { publicAccess, requireAnyCapability, requireCapability } from '../lib/policy.ts'
import { requireSession } from '../middleware/auth.ts'
import { defineRoute } from '../middleware/policy.ts'
import type { Services } from '../services/index.ts'

// «Utseende → Menyer» and «Utseende → Globale sett» (M1.5, K-132, K-106): `edit_theme_options`, as WordPress. The site reads a menu by
// its theme location and a global set by its slug, under /public (only what is published, with cache tags).

const errorResponse = (description: string) => ({ content: { 'application/json': { schema: ApiError } }, description })
const json = <T>(schema: T, description: string) => ({ content: { 'application/json': { schema } }, description })
const THEME = requireCapability('edit_theme_options')
const NOTE = 'Needs the X-CSRF-Token header of the session, a same-origin request and an application/json body.'
const IdParams = z.object({ id: z.uuid() })

// The menu tree is recursive (shared/menus.ts). The OpenAPI generator cannot draw a recursive schema, so the routes describe an item
// in words; the service checks the whole tree with MenuItems (a 400 names what is wrong).
const ITEMS_NOTE =
  'The tree of items: { id, kind (page, post, category, post_tag, custom), objectId or url, label, newTab, cssClass, description, children }.'
const MenuDetailDoc = MenuDetail.extend({ items: z.array(z.unknown()).openapi({ description: ITEMS_NOTE }) })
const UpdateMenuBody = z
  .strictObject({ name: z.string().trim().min(1).max(200), items: z.array(z.unknown()).max(500) })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Send at least one field' })
const PublicMenuDoc = PublicMenuResponse.extend({
  items: z.array(z.unknown()).openapi({
    description:
      'The tree as the site draws it: { id, label, url, newTab, cssClass, description, objectId, children }.',
  }),
})
const refused = {
  401: errorResponse('Not signed in'),
  403: errorResponse('CSRF token missing or wrong, or no edit_theme_options'),
}

const listMenus = defineRoute({
  method: 'get',
  path: '/menus',
  tags: ['appearance'],
  summary: 'The menus',
  policy: THEME,
  responses: { 200: json(MenuListResponse, 'The menus, by name'), ...refused },
})
const createMenu = defineRoute({
  method: 'post',
  path: '/menus',
  tags: ['appearance'],
  summary: 'Make a menu',
  description: NOTE,
  policy: THEME,
  request: { body: { required: true, content: { 'application/json': { schema: CreateMenuRequest } } } },
  responses: { 201: json(MenuDetailDoc, 'The new menu'), 400: errorResponse('Invalid request'), ...refused },
})
const getMenu = defineRoute({
  method: 'get',
  path: '/menus/{id}',
  tags: ['appearance'],
  summary: 'One menu, with what its items name now',
  policy: THEME,
  request: { params: IdParams },
  responses: { 200: json(MenuDetailDoc, 'The menu'), 404: errorResponse('No such menu'), ...refused },
})
const updateMenu = defineRoute({
  method: 'patch',
  path: '/menus/{id}',
  tags: ['appearance'],
  summary: 'Change a menu: its name, or its whole tree of items',
  description: `\`invalid_menu_item\` names an item whose content, term or address is not allowed. ${NOTE}`,
  policy: THEME,
  request: {
    params: IdParams,
    body: { required: true, content: { 'application/json': { schema: UpdateMenuBody } } },
  },
  responses: {
    200: json(MenuDetailDoc, 'The menu afterwards'),
    400: errorResponse('Invalid request, or `invalid_menu_item`'),
    404: errorResponse('No such menu'),
    ...refused,
  },
})
const deleteMenu = defineRoute({
  method: 'delete',
  path: '/menus/{id}',
  tags: ['appearance'],
  summary: 'Delete a menu (its locations show nothing)',
  description: NOTE,
  policy: THEME,
  request: { params: IdParams },
  responses: { 204: { description: 'Deleted' }, 404: errorResponse('No such menu'), ...refused },
})
const getLocations = defineRoute({
  method: 'get',
  path: '/menu-locations',
  tags: ['appearance'],
  summary: 'Which menu stands in each theme location',
  policy: THEME,
  responses: { 200: json(MenuLocationsResponse, 'The locations'), ...refused },
})
const putLocations = defineRoute({
  method: 'put',
  path: '/menu-locations',
  tags: ['appearance'],
  summary: '«Administrer plasseringer»',
  description: `The locations come from the active theme's theme.json (\`menus\`). ${NOTE}`,
  policy: THEME,
  request: { body: { required: true, content: { 'application/json': { schema: UpdateMenuLocationsRequest } } } },
  responses: {
    200: json(MenuLocationsResponse, 'The locations afterwards'),
    400: errorResponse('Invalid request, or `invalid_menu`'),
    ...refused,
  },
})
const listSets = defineRoute({
  method: 'get',
  path: '/global-sets',
  tags: ['appearance'],
  summary: 'The global sets',
  policy: THEME,
  responses: { 200: json(GlobalSetListResponse, 'The sets, by name'), ...refused },
})
const createSet = defineRoute({
  method: 'post',
  path: '/global-sets',
  tags: ['appearance'],
  summary: 'Make a global set',
  description: `\`slug_taken\` when the slug asked for is in use. ${NOTE}`,
  policy: THEME,
  request: { body: { required: true, content: { 'application/json': { schema: CreateGlobalSetRequest } } } },
  responses: {
    201: json(GlobalSetDetail, 'The new set'),
    400: errorResponse('Invalid request'),
    409: errorResponse('`slug_taken`'),
    ...refused,
  },
})
const getSet = defineRoute({
  method: 'get',
  path: '/global-sets/{id}',
  tags: ['appearance'],
  summary: 'One global set, with its blocks',
  policy: THEME,
  request: { params: IdParams },
  responses: { 200: json(GlobalSetDetail, 'The set'), 404: errorResponse('No such set'), ...refused },
})
const updateSet = defineRoute({
  method: 'patch',
  path: '/global-sets/{id}',
  tags: ['appearance'],
  summary: "Change a global set's name or blocks",
  description: `The blocks are checked as content's are (\`invalid_blocks\`; custom HTML needs unfiltered_html). ${NOTE}`,
  policy: THEME,
  request: {
    params: IdParams,
    body: { required: true, content: { 'application/json': { schema: UpdateGlobalSetRequest } } },
  },
  responses: {
    200: json(GlobalSetDetail, 'The set afterwards'),
    400: errorResponse('Invalid request, or `invalid_blocks`'),
    404: errorResponse('No such set'),
    ...refused,
  },
})
const deleteSet = defineRoute({
  method: 'delete',
  path: '/global-sets/{id}',
  tags: ['appearance'],
  summary: 'Delete a global set',
  description: NOTE,
  policy: THEME,
  request: { params: IdParams },
  responses: { 204: { description: 'Deleted' }, 404: errorResponse('No such set'), ...refused },
})
const publicMenu = defineRoute({
  method: 'get',
  path: '/public/menus/{location}',
  tags: ['public'],
  summary: 'The menu in a theme location',
  description: 'Published content only; an item whose content is not published is left out, its children in its place.',
  policy: publicAccess(),
  request: { params: z.object({ location: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/) }) },
  responses: {
    200: json(PublicMenuDoc, 'The menu (no items when none is placed there)'),
    400: errorResponse('Invalid location'),
  },
})
const publicSet = defineRoute({
  method: 'get',
  path: '/public/global-sets/{slug}',
  tags: ['public'],
  summary: 'A global set',
  policy: publicAccess(),
  request: { params: z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/) }) },
  responses: {
    200: json(PublicGlobalSetResponse, 'The set, or `found: false`'),
    400: errorResponse('Invalid slug'),
  },
})

const embedPreview = defineRoute({
  method: 'post',
  path: '/oembed/preview',
  tags: ['content'],
  summary: 'What an «Innbygging» block shows for an address (K-225)',
  description:
    "The provider (from toascribe's fixed list), the title, the player's address and the thumbnail's, read by the server through " +
    'safeFetch and kept for a day. An address of no known provider answers `provider: null`: the block is then a link. The save ' +
    'reads it again, whatever the editor sends.',
  policy: requireAnyCapability('edit_posts', 'edit_pages', 'edit_theme_options'),
  request: { body: { required: true, content: { 'application/json': { schema: EmbedPreviewRequest } } } },
  responses: { 200: json(EmbedPreviewResponse, 'What the block shows'), ...refused },
})

const setChoices = defineRoute({
  method: 'get',
  path: '/global-sets/choices',
  tags: ['appearance'],
  summary: 'The global sets to choose from in the «Globalt sett» block',
  description: 'Slug and name only, for anyone who edits content (the sets themselves need edit_theme_options).',
  policy: requireAnyCapability('edit_posts', 'edit_pages', 'edit_theme_options'),
  responses: {
    200: json(GlobalSetChoicesResponse, 'The sets'),
    ...refused,
  },
})

const ThemeQuery = z.object({ theme: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/) })
const getCustomize = defineRoute({
  method: 'get',
  path: '/customize',
  tags: ['appearance'],
  summary: "«Tilpass»: the identity and the theme's choices",
  description:
    'For the theme named (the active one, as the site reports it). `mayEditCss` says whether «Ekstra CSS» may change.',
  policy: THEME,
  request: { query: ThemeQuery },
  responses: { 200: json(CustomizeResponse, 'What Tilpass shows'), 400: errorResponse('Invalid query'), ...refused },
})
const patchCustomize = defineRoute({
  method: 'patch',
  path: '/customize',
  tags: ['appearance'],
  summary: '«Tilpass → Publiser»',
  description:
    '«Ekstra CSS» needs edit_css (edit_theme_options and unfiltered_html) and may not hold a `<` (it is written into a <style>). ' +
    NOTE,
  policy: THEME,
  request: { body: { required: true, content: { 'application/json': { schema: UpdateCustomizeRequest } } } },
  responses: {
    200: json(CustomizeResponse, 'What Tilpass shows afterwards'),
    400: errorResponse('Invalid request, or `invalid_media`'),
    ...refused,
  },
})
const publicCustomize = defineRoute({
  method: 'get',
  path: '/public/customize',
  tags: ['public'],
  summary: "The theme's choices, «Ekstra CSS», the logo and the icon",
  policy: publicAccess(),
  request: { query: ThemeQuery },
  responses: { 200: json(PublicCustomizeResponse, 'What the site draws'), 400: errorResponse('Invalid query') },
})

export function createAppearanceApp(services: Services): OpenAPIHono<AppEnv> {
  const context = (c: Parameters<typeof getClientIp>[0]) => ({ ip: getClientIp(c), requestId: c.get('requestId') })
  const appearance = services.appearance
  return new OpenAPIHono<AppEnv>()
    .openapi(listMenus, async (c) => c.json(await appearance.menus(await requireSession(c)), 200))
    .openapi(createMenu, async (c) =>
      c.json(await appearance.createMenu(await requireSession(c), c.req.valid('json'), context(c)), 201),
    )
    .openapi(getMenu, async (c) => c.json(await appearance.menu(await requireSession(c), c.req.valid('param').id), 200))
    .openapi(updateMenu, async (c) =>
      c.json(
        await appearance.updateMenu(await requireSession(c), c.req.valid('param').id, c.req.valid('json'), context(c)),
        200,
      ),
    )
    .openapi(deleteMenu, async (c) => {
      await appearance.deleteMenu(await requireSession(c), c.req.valid('param').id, context(c))
      return c.body(null, 204)
    })
    .openapi(getLocations, async (c) => c.json(await appearance.locations(await requireSession(c)), 200))
    .openapi(putLocations, async (c) =>
      c.json(await appearance.updateLocations(await requireSession(c), c.req.valid('json'), context(c)), 200),
    )
    .openapi(embedPreview, async (c) =>
      c.json(await services.embeds.preview(await requireSession(c), c.req.valid('json').url), 200),
    )
    .openapi(setChoices, async (c) => c.json(await appearance.globalSetChoices(await requireSession(c)), 200))
    .openapi(listSets, async (c) => c.json(await appearance.globalSets(await requireSession(c)), 200))
    .openapi(createSet, async (c) =>
      c.json(await appearance.createGlobalSet(await requireSession(c), c.req.valid('json'), context(c)), 201),
    )
    .openapi(getSet, async (c) =>
      c.json(await appearance.globalSet(await requireSession(c), c.req.valid('param').id), 200),
    )
    .openapi(updateSet, async (c) =>
      c.json(
        await appearance.updateGlobalSet(
          await requireSession(c),
          c.req.valid('param').id,
          c.req.valid('json'),
          context(c),
        ),
        200,
      ),
    )
    .openapi(deleteSet, async (c) => {
      await appearance.deleteGlobalSet(await requireSession(c), c.req.valid('param').id, context(c))
      return c.body(null, 204)
    })
    .openapi(publicMenu, async (c) => c.json(await appearance.publicMenu(c.req.valid('param').location), 200))
    .openapi(publicSet, async (c) => c.json(await appearance.publicGlobalSet(c.req.valid('param').slug), 200))
    .openapi(getCustomize, async (c) =>
      c.json(await services.customize.get(await requireSession(c), c.req.valid('query').theme), 200),
    )
    .openapi(patchCustomize, async (c) =>
      c.json(await services.customize.update(await requireSession(c), c.req.valid('json'), context(c)), 200),
    )
    .openapi(publicCustomize, async (c) => c.json(await services.customize.publicFor(c.req.valid('query').theme), 200))
}
