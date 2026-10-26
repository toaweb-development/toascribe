// Who may call a route (K-312; security §2: authorisation on every route, none open by oversight).
//
// Every route is made with `defineRoute({ ..., policy })`, and `policy` is a required property, so a route without one does
// not compile. The guard is also what enforces it at run time, and `findUnguardedRoutes` lists any route in an app that was
// registered some other way (`app.get(...)`, a missing guard), which a test and the start-up of the api both check.
import type { Capability } from '@toascribe/shared'

/** Open to anyone, signed in or not. A handler that wants to know who is asking calls `currentAuth(c)`. */
export interface PublicPolicy {
  readonly kind: 'public'
}

/** Any signed-in account. */
export interface AuthenticatedPolicy {
  readonly kind: 'authenticated'
  /**
   * Also let a session that has passed the password but not yet the second factor through. Only the routes that finish
   * that step (and log out) say so.
   */
  readonly allowPendingMfa?: boolean
}

/** A signed-in account whose roles together hold the capability. */
export interface CapabilityPolicy {
  readonly kind: 'capability'
  readonly capability: Capability | (string & {})
}

/**
 * A signed-in account that holds at least one of the capabilities. For routes that serve several content types, where the type
 * (and so the capability that counts) is only known from the request or the item: the door lets in anyone who holds one, and the
 * service checks the right one (the content routes: `edit_posts` for posts, `edit_pages` for pages).
 */
export interface AnyCapabilityPolicy {
  readonly kind: 'any-capability'
  readonly capabilities: readonly (Capability | (string & {}))[]
}

/**
 * The setup wizard's routes (M0.4). Nobody is signed in yet, so the caller proves itself with the one-time setup token in
 * the `X-Setup-Token` header, and the routes exist only while the site is not installed: afterwards they answer 404, as if
 * they had never been there. The guard (middleware/policy.ts) does both.
 */
export interface SetupTokenPolicy {
  readonly kind: 'setup-token'
}

export type Policy = PublicPolicy | AuthenticatedPolicy | CapabilityPolicy | AnyCapabilityPolicy | SetupTokenPolicy

/** What a state-changing request may carry as a body. JSON is the default; a route that takes files says `multipart`. */
export type BodyType = 'json' | 'multipart'

export function publicAccess(): PublicPolicy {
  return { kind: 'public' }
}

export function authenticated(options: { readonly allowPendingMfa?: boolean } = {}): AuthenticatedPolicy {
  return { kind: 'authenticated', ...(options.allowPendingMfa === true ? { allowPendingMfa: true } : {}) }
}

export function requireCapability(capability: CapabilityPolicy['capability']): CapabilityPolicy {
  return { kind: 'capability', capability }
}

export function requireAnyCapability(...capabilities: AnyCapabilityPolicy['capabilities']): AnyCapabilityPolicy {
  if (capabilities.length === 0) {
    throw new Error('requireAnyCapability needs at least one capability')
  }
  return { kind: 'any-capability', capabilities }
}

export function setupToken(): SetupTokenPolicy {
  return { kind: 'setup-token' }
}

export function describePolicy(policy: Policy): string {
  switch (policy.kind) {
    case 'public':
      return 'public'
    case 'authenticated':
      return policy.allowPendingMfa === true ? 'authenticated (also half-signed-in)' : 'authenticated'
    case 'capability':
      return `capability:${policy.capability}`
    case 'any-capability':
      return `capability:${policy.capabilities.join('|')}`
    case 'setup-token':
      return 'setup-token'
    default:
      return policy satisfies never
  }
}
