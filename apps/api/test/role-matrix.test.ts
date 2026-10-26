import { z } from '@hono/zod-openapi'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { publicAccess, requireCapability } from '../src/lib/policy.ts'
import { defineRoute, findUnguardedRoutes, listRoutePolicies } from '../src/middleware/policy.ts'
import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp } from './harness.ts'
import { EXPECTED_POLICIES } from './policies.ts'
import { describeRoleMatrix } from './role-matrix.ts'
import type { MatrixCase } from './role-matrix.ts'

noticeIfSkipped('role-matrix')

const SOMEONE_ELSES_SESSION = '0198a3c2-0000-7000-8000-000000000000'
const NO_SUCH_FACTOR = '0198a3c2-0000-7000-8000-000000000001'
const NO_SUCH_CONTENT = '0198a3c2-0000-7000-8000-0000000000ee'
/** Looks like a token and is none: the one-time-link routes answer 400 `invalid_token`. */
const NOT_A_TOKEN = 'A'.repeat(43)

/** Routes that exist only for this test, to show that the matrix tells capabilities apart. */
const TEST_ONLY_POLICIES = {
  'GET /api/v1/test/manage-options': 'capability:manage_options',
  'GET /api/v1/test/edit-posts': 'capability:edit_posts',
  'POST /api/v1/test/publish-pages': 'capability:publish_pages',
  'GET /api/v1/test/open': 'public',
} as const

const ok = { anonymous: 401, administrator: 200, editor: 200, author: 200, contributor: 200, subscriber: 200 } as const

/** Add a case here for every endpoint a later task adds. */
const CASES: readonly MatrixCase[] = [
  // Public
  { route: 'GET /api/health', method: 'GET', path: '/api/health', expected: { ...ok, anonymous: 200 } },
  { route: 'GET /api/ready', method: 'GET', path: '/api/ready', expected: { ...ok, anonymous: 200 } },
  {
    route: 'GET /api/v1/openapi.json',
    method: 'GET',
    path: '/api/v1/openapi.json',
    expected: { ...ok, anonymous: 200 },
  },
  {
    route: 'GET /api/v1/auth/session',
    method: 'GET',
    path: '/api/v1/auth/session',
    expected: { ...ok, anonymous: 200 },
  },
  {
    // Each role signs in as itself; the anonymous caller tries a name nobody has.
    route: 'POST /api/v1/auth/login',
    method: 'POST',
    path: '/api/v1/auth/login',
    body: (actor) => ({
      login: actor === 'anonymous' ? 'nobody' : `matrix-${actor}`,
      password: actor === 'anonymous' ? 'x' : TEST_PASSWORD,
    }),
    ownRefusal: true,
    expected: { ...ok, anonymous: 401 },
  },
  // The flows around the login: anyone may call them, and none of them says whether an account exists
  {
    route: 'GET /api/v1/auth/options',
    method: 'GET',
    path: '/api/v1/auth/options',
    expected: { ...ok, anonymous: 200 },
  },
  {
    route: 'POST /api/v1/auth/password/lost',
    method: 'POST',
    path: '/api/v1/auth/password/lost',
    // A name of its own for each caller: the same name asked for six times in a row is made to wait.
    body: (actor) => ({ login: `nobody-at-all-${actor}` }),
    expected: {
      ...ok,
      anonymous: 202,
      administrator: 202,
      editor: 202,
      author: 202,
      contributor: 202,
      subscriber: 202,
    },
  },
  {
    route: 'POST /api/v1/auth/password/reset',
    method: 'POST',
    path: '/api/v1/auth/password/reset',
    json: { token: NOT_A_TOKEN, password: 'a perfectly fine password' },
    expected: {
      ...ok,
      anonymous: 400,
      administrator: 400,
      editor: 400,
      author: 400,
      contributor: 400,
      subscriber: 400,
    },
  },
  {
    route: 'POST /api/v1/auth/password/set',
    method: 'POST',
    path: '/api/v1/auth/password/set',
    json: { token: NOT_A_TOKEN, password: 'a perfectly fine password' },
    expected: {
      ...ok,
      anonymous: 400,
      administrator: 400,
      editor: 400,
      author: 400,
      contributor: 400,
      subscriber: 400,
    },
  },
  {
    // Registration is switched on for this suite (see beforeAll). Each caller names itself, so none collides with another.
    route: 'POST /api/v1/auth/register',
    method: 'POST',
    path: '/api/v1/auth/register',
    body: (actor) => ({ username: `registered-${actor}`, email: `registered-${actor}@example.test` }),
    expected: {
      ...ok,
      anonymous: 202,
      administrator: 202,
      editor: 202,
      author: 202,
      contributor: 202,
      subscriber: 202,
    },
  },
  // A half-signed-in session may pass its second factor; a complete one is told there is nothing to pass
  {
    route: 'POST /api/v1/auth/mfa/verify',
    method: 'POST',
    path: '/api/v1/auth/mfa/verify',
    json: { type: 'totp', code: '123456' },
    expected: { ...ok, administrator: 409, editor: 409, author: 409, contributor: 409, subscriber: 409 },
  },
  // Any signed-in account
  {
    route: 'POST /api/v1/auth/logout',
    method: 'POST',
    path: '/api/v1/auth/logout',
    expected: { ...ok, administrator: 204, editor: 204, author: 204, contributor: 204, subscriber: 204 },
  },
  // The `read` capability: all five roles have it
  { route: 'GET /api/v1/me', method: 'GET', path: '/api/v1/me', expected: ok },
  { route: 'PATCH /api/v1/me', method: 'PATCH', path: '/api/v1/me', json: { nickname: 'matrix' }, expected: ok },
  {
    route: 'PATCH /api/v1/me/preferences',
    method: 'PATCH',
    path: '/api/v1/me/preferences',
    json: { showToolbarOnSite: true },
    expected: ok,
  },
  { route: 'GET /api/v1/admin/menu', method: 'GET', path: '/api/v1/admin/menu', expected: ok },
  { route: 'GET /api/v1/dashboard/glance', method: 'GET', path: '/api/v1/dashboard/glance', expected: ok },
  { route: 'GET /api/v1/notices', method: 'GET', path: '/api/v1/notices', expected: ok },
  {
    route: 'POST /api/v1/notices/:key/dismiss',
    method: 'POST',
    path: '/api/v1/notices/matrix.no_such_notice/dismiss',
    expected: { ...ok, administrator: 404, editor: 404, author: 404, contributor: 404, subscriber: 404 },
  },
  { route: 'GET /api/v1/me/sessions', method: 'GET', path: '/api/v1/me/sessions', expected: ok },
  { route: 'DELETE /api/v1/me/sessions', method: 'DELETE', path: '/api/v1/me/sessions', expected: ok },
  {
    route: 'DELETE /api/v1/me/sessions/:id',
    method: 'DELETE',
    path: `/api/v1/me/sessions/${SOMEONE_ELSES_SESSION}`,
    expected: { ...ok, administrator: 404, editor: 404, author: 404, contributor: 404, subscriber: 404 },
  },
  { route: 'GET /api/v1/me/mfa', method: 'GET', path: '/api/v1/me/mfa', expected: ok },
  {
    route: 'POST /api/v1/me/mfa/totp',
    method: 'POST',
    path: '/api/v1/me/mfa/totp',
    json: {},
    expected: { ...ok, administrator: 201, editor: 201, author: 201, contributor: 201, subscriber: 201 },
  },
  {
    route: 'POST /api/v1/me/mfa/totp/:id/confirm',
    method: 'POST',
    path: `/api/v1/me/mfa/totp/${NO_SUCH_FACTOR}/confirm`,
    json: { code: '123456', password: TEST_PASSWORD },
    expected: { ...ok, administrator: 404, editor: 404, author: 404, contributor: 404, subscriber: 404 },
  },
  {
    // Adding a factor in a complete session needs the password (Tor, 2026-10-22).
    route: 'POST /api/v1/me/mfa/totp/:id/confirm',
    method: 'POST',
    path: `/api/v1/me/mfa/totp/${NO_SUCH_FACTOR}/confirm`,
    json: { code: '123456' },
    expected: { ...ok, administrator: 400, editor: 400, author: 400, contributor: 400, subscriber: 400 },
  },
  {
    route: 'DELETE /api/v1/me/mfa/:id',
    method: 'DELETE',
    path: `/api/v1/me/mfa/${NO_SUCH_FACTOR}`,
    json: { password: TEST_PASSWORD },
    expected: { ...ok, administrator: 404, editor: 404, author: 404, contributor: 404, subscriber: 404 },
  },
  {
    // A code from the app is not proof any more, only the password.
    route: 'DELETE /api/v1/me/mfa/:id',
    method: 'DELETE',
    path: `/api/v1/me/mfa/${NO_SUCH_FACTOR}`,
    json: { code: '123456' },
    expected: { ...ok, administrator: 400, editor: 400, author: 400, contributor: 400, subscriber: 400 },
  },
  {
    route: 'DELETE /api/v1/me/mfa/:id',
    method: 'DELETE',
    path: `/api/v1/me/mfa/${NO_SUCH_FACTOR}`,
    json: { password: 'not the password at all' },
    ownRefusal: true,
    expected: { ...ok, administrator: 403, editor: 403, author: 403, contributor: 403, subscriber: 403 },
  },
  {
    route: 'POST /api/v1/me/mfa/recovery-codes',
    method: 'POST',
    path: '/api/v1/me/mfa/recovery-codes',
    json: { password: TEST_PASSWORD },
    expected: { ...ok, administrator: 409, editor: 409, author: 409, contributor: 409, subscriber: 409 },
  },
  {
    route: 'POST /api/v1/me/mfa/recovery-codes',
    method: 'POST',
    path: '/api/v1/me/mfa/recovery-codes',
    json: { code: '123456' },
    expected: { ...ok, administrator: 400, editor: 400, author: 400, contributor: 400, subscriber: 400 },
  },
  {
    route: 'PATCH /api/v1/me/password',
    method: 'PATCH',
    path: '/api/v1/me/password',
    json: { currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD },
    expected: { ...ok, administrator: 204, editor: 204, author: 204, contributor: 204, subscriber: 204 },
  },
  {
    route: 'POST /api/v1/me/email-change',
    method: 'POST',
    path: '/api/v1/me/email-change',
    body: (actor) => ({ newEmail: `changed-${actor}@example.test`, password: TEST_PASSWORD }),
    expected: { ...ok, administrator: 202, editor: 202, author: 202, contributor: 202, subscriber: 202 },
  },
  {
    route: 'POST /api/v1/me/email-change/confirm',
    method: 'POST',
    path: '/api/v1/me/email-change/confirm',
    json: { token: NOT_A_TOKEN },
    expected: { ...ok, administrator: 400, editor: 400, author: 400, contributor: 400, subscriber: 400 },
  },
  // The `manage_options` capability: only the administrator
  {
    route: 'POST /api/v1/system/test-email',
    method: 'POST',
    path: '/api/v1/system/test-email',
    json: {},
    expected: { ...ok, editor: 403, author: 403, contributor: 403, subscriber: 403, administrator: 202 },
  },
  // The `list_users` and `promote_users` capabilities: only the administrator
  {
    route: 'GET /api/v1/users',
    method: 'GET',
    path: '/api/v1/users',
    expected: { ...ok, editor: 403, author: 403, contributor: 403, subscriber: 403 },
  },
  {
    // An account nobody has: the administrator gets a 200 that names it as not found, and changes nothing.
    route: 'PUT /api/v1/users/roles',
    method: 'PUT',
    path: '/api/v1/users/roles',
    json: { userIds: ['0198a3c2-0000-7000-8000-0000000000cc'], role: 'subscriber' },
    expected: { ...ok, editor: 403, author: 403, contributor: 403, subscriber: 403 },
  },
  // The content API (M1.1): `edit_posts` at the door, so the subscriber is turned away by the guard; every other role gets through
  // to the service. Here an item nobody has, so the item routes answer 404; content-matrix.test.ts has the full matrix of roles
  // against own and others' posts and pages, published and not.
  {
    route: 'GET /api/v1/content',
    method: 'GET',
    path: '/api/v1/content?type=post',
    expected: { ...ok, subscriber: 403 },
  },
  {
    route: 'POST /api/v1/content',
    method: 'POST',
    path: '/api/v1/content',
    json: { type: 'post', title: 'Matrise' },
    expected: { ...ok, administrator: 201, editor: 201, author: 201, contributor: 201, subscriber: 403 },
  },
  {
    // Choosing authors needs edit_others_posts: the author and the contributor are turned away by the service.
    route: 'GET /api/v1/content/authors',
    method: 'GET',
    path: '/api/v1/content/authors?type=post',
    ownRefusal: true,
    expected: { ...ok, author: 403, contributor: 403, subscriber: 403 },
  },
  {
    route: 'POST /api/v1/content/bulk',
    method: 'POST',
    path: '/api/v1/content/bulk',
    json: { action: 'trash', ids: [NO_SUCH_CONTENT] },
    expected: { ...ok, subscriber: 403 },
  },
  ...(['GET', 'PATCH', 'DELETE'] as const).map((method) => ({
    route: `${method} /api/v1/content/:id`,
    method,
    path: `/api/v1/content/${NO_SUCH_CONTENT}`,
    ...(method === 'PATCH' ? { json: { title: 'x' } } : {}),
    expected: { ...ok, administrator: 404, editor: 404, author: 404, contributor: 404, subscriber: 403 },
  })),
  ...(['publish', 'trash', 'restore'] as const).map((action) => ({
    route: `POST /api/v1/content/:id/${action}`,
    method: 'POST',
    path: `/api/v1/content/${NO_SUCH_CONTENT}/${action}`,
    expected: { ...ok, administrator: 404, editor: 404, author: 404, contributor: 404, subscriber: 403 },
  })),
  // PROTOTYPE (M0.6): the editor's image uploads. `upload_files` (not the contributor or the subscriber) for an upload, sent as
  // JSON here, so a role that may upload gets the validator's 415 (not multipart).
  {
    route: 'POST /api/v1/prototype/editor/uploads',
    method: 'POST',
    path: '/api/v1/prototype/editor/uploads',
    json: {},
    expected: { ...ok, administrator: 415, editor: 415, author: 415, contributor: 403, subscriber: 403 },
  },
  {
    route: 'GET /api/v1/prototype/editor/uploads/:name',
    method: 'GET',
    path: '/api/v1/prototype/editor/uploads/0198a3c2-0000-7000-8000-0000000000dd.png',
    expected: { ...ok, administrator: 404, editor: 404, author: 404, contributor: 404, subscriber: 403 },
  },
  // The setup wizard (M0.4): no role opens the token-gated routes, an administrator included. Only the setup token does, and
  // the matrix sends none. After the install they would all be 404 (setup.test.ts).
  {
    route: 'GET /api/v1/setup/status',
    method: 'GET',
    path: '/api/v1/setup/status',
    expected: { ...ok, anonymous: 200 },
  },
  ...(
    [
      ['GET /api/v1/setup/state', 'GET', '/api/v1/setup/state', undefined],
      ['POST /api/v1/setup/token/verify', 'POST', '/api/v1/setup/token/verify', undefined],
      ['GET /api/v1/setup/check', 'GET', '/api/v1/setup/check', undefined],
      ['PUT /api/v1/setup/site', 'PUT', '/api/v1/setup/site', {}],
      ['PUT /api/v1/setup/email', 'PUT', '/api/v1/setup/email', {}],
      ['POST /api/v1/setup/email/test', 'POST', '/api/v1/setup/email/test', { to: 'me@example.test' }],
      ['POST /api/v1/setup/email/skip', 'POST', '/api/v1/setup/email/skip', undefined],
      ['POST /api/v1/setup/recovery-key', 'POST', '/api/v1/setup/recovery-key', undefined],
      ['POST /api/v1/setup/install', 'POST', '/api/v1/setup/install', {}],
    ] as const
  ).map(([route, method, path, json]): MatrixCase => ({
    route,
    method,
    path,
    ...(json === undefined ? {} : { json }),
    ownRefusal: true,
    expected: { anonymous: 401, administrator: 401, editor: 401, author: 401, contributor: 401, subscriber: 401 },
  })),
  // Routes that exist for this test: the matrix has to tell capabilities apart
  {
    route: 'GET /api/v1/test/manage-options',
    method: 'GET',
    path: '/api/v1/test/manage-options',
    expected: { ...ok, editor: 403, author: 403, contributor: 403, subscriber: 403 },
  },
  {
    route: 'GET /api/v1/test/edit-posts',
    method: 'GET',
    path: '/api/v1/test/edit-posts',
    expected: { ...ok, subscriber: 403 },
  },
  {
    route: 'POST /api/v1/test/publish-pages',
    method: 'POST',
    path: '/api/v1/test/publish-pages',
    json: {},
    expected: { ...ok, author: 403, contributor: 403, subscriber: 403 },
  },
  { route: 'GET /api/v1/test/open', method: 'GET', path: '/api/v1/test/open', expected: { ...ok, anonymous: 200 } },
]

describe.skipIf(TEST_DATABASE_URL === undefined)('role matrix (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp

  beforeAll(async () => {
    env = await startAuthApp()
    // The register route answers 403 while the setting is off; the matrix is about who may call it, so it is on here.
    await env.query(`update setting set value = 'true'::jsonb where key = 'users_can_register'`)
    const response = { 200: { content: { 'application/json': { schema: z.object({}) } }, description: 'ok' } } as const
    env.app.openapi(
      defineRoute({
        method: 'get',
        path: '/api/v1/test/manage-options',
        policy: requireCapability('manage_options'),
        responses: response,
      }),
      (c) => c.json({}, 200),
    )
    env.app.openapi(
      defineRoute({
        method: 'get',
        path: '/api/v1/test/edit-posts',
        policy: requireCapability('edit_posts'),
        responses: response,
      }),
      (c) => c.json({}, 200),
    )
    env.app.openapi(
      defineRoute({
        method: 'post',
        path: '/api/v1/test/publish-pages',
        policy: requireCapability('publish_pages'),
        responses: response,
      }),
      (c) => c.json({}, 200),
    )
    env.app.openapi(
      defineRoute({ method: 'get', path: '/api/v1/test/open', policy: publicAccess(), responses: response }),
      (c) => c.json({}, 200),
    )
  })
  afterAll(async () => {
    await env.close()
  })

  describeRoleMatrix('every endpoint, every role', () => env, CASES, { ...EXPECTED_POLICIES, ...TEST_ONLY_POLICIES })

  it('the app has exactly the routes the policy list names (plus the test routes)', () => {
    expect(findUnguardedRoutes(env.app)).toEqual([])
    expect(Object.fromEntries(listRoutePolicies(env.app))).toEqual({
      ...EXPECTED_POLICIES,
      ...Object.fromEntries(Object.entries(TEST_ONLY_POLICIES)),
    })
  })
})
