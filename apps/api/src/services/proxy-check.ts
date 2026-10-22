// Is the stack told who its visitors are? The proxy in the stack believes the headers of the external proxy only when
// TOASCRIBE_TRUSTED_PROXY names it (README, «Behind a reverse proxy»). Left empty, `X-Real-IP` is the external proxy's own
// address on every request: all visitors share one rate-limit bucket (20 wrong logins from anyone slow everyone down) and every
// IP in the audit log and the session list is the gateway. Nothing is wrong with the stack itself, so it cannot refuse to start;
// it looks at the first requests instead and says so once in the log.
//
// The state is kept in memory, per process, and is read through `status()` (the setup wizard and Site Health, later). It is
// worked out again after a restart, which is when the operator has changed the variable anyway.
import type { Logger } from 'pino'

import { normalizeIp } from '../lib/client-ip.ts'
import { isPrivateAddress } from '../lib/private-address.ts'

/** The verdict is given after this many requests that carried an address ... */
export const PROXY_CHECK_REQUESTS = 50
/** ... or, when at least `PROXY_CHECK_MIN_REQUESTS` have come, after this long since the first one (a quiet site). */
export const PROXY_CHECK_MINUTES = 10
export const PROXY_CHECK_MIN_REQUESTS = 10

export const PROXY_VARIABLE = 'TOASCRIBE_TRUSTED_PROXY'

export type ProxyState =
  /** The variable is set: nothing to check. */
  | 'configured'
  /** Still watching the first requests. */
  | 'watching'
  /** Visitors have different addresses, or a public one: the proxy tells the stack who they are. */
  | 'ok'
  /** The variable is empty and every request came from the same private address. */
  | 'warning'

export interface ProxyStatus {
  readonly state: ProxyState
  /** Requests with an address seen so far (stops counting when the verdict is given). */
  readonly observed: number
  /** The one private address, in the `warning` state. */
  readonly address: string | null
}

export interface ProxyCheck {
  /** Tells the check about a request: the value of its `X-Real-IP` header, or undefined when it had none. */
  observe: (xRealIp: string | undefined) => void
  status: () => ProxyStatus
}

export function createProxyCheck(options: {
  readonly trustedProxy: string
  readonly logger: Logger
  readonly clock: () => Date
}): ProxyCheck {
  const { trustedProxy, logger, clock } = options
  const addresses = new Set<string>()
  let observed = 0
  let firstAt: number | null = null
  let state: ProxyState = trustedProxy.trim() === '' ? 'watching' : 'configured'
  let warnedAddress: string | null = null

  function decide(): void {
    const [only] = addresses
    if (addresses.size === 1 && only !== undefined && isPrivateAddress(only)) {
      state = 'warning'
      warnedAddress = only
      logger.warn(
        { variable: PROXY_VARIABLE, address: only, requests: observed },
        `${PROXY_VARIABLE} is empty and the first ${String(observed)} requests all came from the same private address. ` +
          'Every visitor now shares one rate-limit bucket (a few wrong logins slow down everyone) and every IP address in the ' +
          "audit log and the session list is that of your reverse proxy. Set it to the proxy's address in docker/.env " +
          '(README, «Behind a reverse proxy»).',
      )
    } else {
      state = 'ok'
    }
  }

  return {
    observe(xRealIp) {
      if (state !== 'watching') {
        return
      }
      const address = xRealIp === undefined ? undefined : normalizeIp(xRealIp)
      if (address === undefined) {
        return
      }
      const now = clock().getTime()
      firstAt ??= now
      observed += 1
      addresses.add(address)
      // Two different addresses, or a public one: the question is answered at once.
      if (addresses.size > 1 || !isPrivateAddress(address)) {
        state = 'ok'
        return
      }
      const quietLongEnough = observed >= PROXY_CHECK_MIN_REQUESTS && now - firstAt >= PROXY_CHECK_MINUTES * 60_000
      if (observed >= PROXY_CHECK_REQUESTS || quietLongEnough) {
        decide()
      }
    },
    status: () => ({ state, observed, address: warnedAddress }),
  }
}
