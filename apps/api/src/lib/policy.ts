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

export type Policy = PublicPolicy | AuthenticatedPolicy | CapabilityPolicy

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

export function describePolicy(policy: Policy): string {
  switch (policy.kind) {
    case 'public':
      return 'public'
    case 'authenticated':
      return policy.allowPendingMfa === true ? 'authenticated (also half-signed-in)' : 'authenticated'
    case 'capability':
      return `capability:${policy.capability}`
    default:
      return policy satisfies never
  }
}
