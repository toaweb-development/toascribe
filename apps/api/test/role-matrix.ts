// The role matrix: for every endpoint, the five built-in roles and an anonymous caller each make the call, and the status is
// compared with what the endpoint's policy says (K-312). Later tasks add their endpoints to the list in role-matrix.test.ts
// and to test/policies.ts; a test fails for a route that is in the app but not in the matrix.
import { DEFAULT_ROLES } from '@toascribe/shared'
import type { BuiltInRole } from '@toascribe/shared'
import { afterAll, describe, expect, it } from 'vitest'

import { ROLES, TEST_PASSWORD } from './harness.ts'
import type { AuthTestApp, CreatedAccount, TestClient } from './harness.ts'

export type Actor = 'anonymous' | BuiltInRole
export const ACTORS: readonly Actor[] = ['anonymous', ...ROLES]

export interface MatrixCase {
  /** The route as `app.routes` lists it (`DELETE /api/v1/me/sessions/:id`): ties the case to test/policies.ts. */
  readonly route: string
  readonly method: string
  /** The path to call, with any parameter filled in. */
  readonly path: string
  /** The body, or a function of the caller. */
  readonly json?: unknown
  readonly body?: (actor: Actor, account: CreatedAccount | undefined) => unknown
  /**
   * The route itself answers 401 or 403 for a reason of its own (login: wrong credentials), so the check that a public
   * route never refuses for lack of a session does not apply.
   */
  readonly ownRefusal?: boolean
  /** The status each caller must get. */
  readonly expected: Readonly<Record<Actor, number>>
}

/** What the policy text of test/policies.ts allows, worked out from the roles' real capability lists. */
export function mustBeRefusedFor(policy: string, actor: Actor): 'ok-or-other' | 401 | 403 {
  if (policy === 'public') {
    return 'ok-or-other'
  }
  if (policy === 'setup-token') {
    // Nobody is let in by who they are, a signed-in administrator included: only the setup token opens these routes.
    return 401
  }
  if (actor === 'anonymous') {
    return 401
  }
  if (policy.startsWith('capability:')) {
    // `capability:a|b` lets in a holder of either.
    const wanted = policy.slice('capability:'.length).split('|')
    const role = DEFAULT_ROLES.find((r) => r.slug === actor)
    return role?.capabilities.some((held) => wanted.includes(held)) === true ? 'ok-or-other' : 403
  }
  return 'ok-or-other'
}

export function describeRoleMatrix(
  title: string,
  getEnv: () => AuthTestApp,
  cases: readonly MatrixCase[],
  policies: Readonly<Record<string, string>>,
): void {
  describe(title, () => {
    const accounts = new Map<BuiltInRole, CreatedAccount>()
    const clients: TestClient[] = []

    async function accountFor(role: BuiltInRole): Promise<CreatedAccount> {
      const known = accounts.get(role)
      if (known !== undefined) {
        return known
      }
      const created = await getEnv().createAccount({ username: `matrix-${role}`, role })
      accounts.set(role, created)
      return created
    }

    async function clientFor(actor: Actor): Promise<{ client: TestClient; account: CreatedAccount | undefined }> {
      const env = getEnv()
      // Every call gets a session of its own, so a call that ends it (logout) cannot disturb the next.
      // Each caller has an address of its own: the flows that count every request per address (lost password, registration) would otherwise run into their limit.
      const client = env.client({ ip: `198.51.100.${String(100 + ACTORS.indexOf(actor))}` })
      clients.push(client)
      if (actor === 'anonymous') {
        return { client, account: undefined }
      }
      const account = await accountFor(actor)
      const res = await client.login(account.username, TEST_PASSWORD)
      expect(res.status, `login as ${actor}`).toBe(200)
      return { client, account }
    }

    afterAll(() => {
      clients.length = 0
    })

    for (const testCase of cases) {
      describe(`${testCase.method} ${testCase.path}`, () => {
        it.each(ACTORS)('answers %s with the expected status', async (actor) => {
          const { client, account } = await clientFor(actor)
          const json = testCase.body === undefined ? testCase.json : testCase.body(actor, account)
          const res = await client.request(testCase.method, testCase.path, json === undefined ? {} : { json })
          expect(res.status).toBe(testCase.expected[actor])
        })

        it('agrees with the policy of the route', () => {
          const policy = policies[testCase.route]
          expect(policy, `${testCase.route} is not in test/policies.ts`).toBeDefined()
          for (const actor of ACTORS) {
            const refused = mustBeRefusedFor(policy ?? '', actor)
            const status = testCase.expected[actor]
            if (refused === 'ok-or-other') {
              if (testCase.ownRefusal === true) {
                continue
              }
              expect([401, 403], `${actor} must get through ${testCase.route}`).not.toContain(status)
            } else {
              expect(status, `${actor} on ${testCase.route}`).toBe(refused)
            }
          }
        })
      })
    }

    it('has a case for every route of the api', () => {
      const covered = new Set(cases.map((c) => c.route))
      const missing = Object.keys(policies).filter((route) => !covered.has(route))
      expect(missing, 'routes with a policy but no case in the matrix').toEqual([])
    })
  })
}
