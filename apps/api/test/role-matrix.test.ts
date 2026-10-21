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
  { route: 'GET /api/v1/me/sessions', method: 'GET', path: '/api/v1/me/sessions', expected: ok },
  { route: 'DELETE /api/v1/me/sessions', method: 'DELETE', path: '/api/v1/me/sessions', expected: ok },
  {
    route: 'DELETE /api/v1/me/sessions/:id',
    method: 'DELETE',
    path: `/api/v1/me/sessions/${SOMEONE_ELSES_SESSION}`,
    expected: { ...ok, administrator: 404, editor: 404, author: 404, contributor: 404, subscriber: 404 },
  },
  // The `manage_options` capability: only the administrator
  {
    route: 'POST /api/v1/system/test-email',
    method: 'POST',
    path: '/api/v1/system/test-email',
    json: {},
    expected: { ...ok, editor: 403, author: 403, contributor: 403, subscriber: 403, administrator: 202 },
  },
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
