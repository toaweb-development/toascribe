// The address the browser used for this request, as the request tells it. Used by the system check to compare it with
// PUBLIC_ORIGIN (cookies, the Origin check and every link in a mail depend on that one value being the address people use).
//
// In order of how directly the browser says it: the `Origin` header (sent on a cross-origin or state-changing request), the
// origin of `Referer` (a same-origin fetch from the wizard carries it), the proxy's `X-Forwarded-Proto` and `-Host` (the
// stack's own proxy replaces them with what it saw unless TOASCRIBE_TRUSTED_PROXY says to believe the one in front of it), and
// last the `Host` header. None of it is trusted for anything: this is shown to the person at the keyboard to help them spot
// a wrong PUBLIC_ORIGIN, and is not a secret.
import type { ObservedOriginSource } from '@toascribe/shared'

export interface RequestAddressHeaders {
  readonly origin?: string | undefined
  readonly referer?: string | undefined
  readonly forwardedProto?: string | undefined
  readonly forwardedHost?: string | undefined
  readonly host?: string | undefined
}

export interface ObservedOrigin {
  readonly origin: string
  readonly source: ObservedOriginSource
}

function originOf(text: string): string | undefined {
  try {
    const url = new URL(text)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.host !== '' ? url.origin : undefined
  } catch {
    return undefined
  }
}

/** The first entry of a header a chain of proxies may have appended to (`a.example, b.internal`): the one nearest the visitor. */
function first(value: string | undefined): string | undefined {
  const entry = value?.split(',')[0]?.trim()
  return entry === undefined || entry === '' ? undefined : entry
}

export function observeOrigin(headers: RequestAddressHeaders, configured: string): ObservedOrigin | null {
  const origin = headers.origin === undefined ? undefined : originOf(headers.origin)
  if (origin !== undefined) {
    return { origin, source: 'origin' }
  }
  const referer = headers.referer === undefined ? undefined : originOf(headers.referer)
  if (referer !== undefined) {
    return { origin: referer, source: 'referer' }
  }
  // Without a protocol header the scheme is not known; the configured one stands in, so only the host can differ.
  const proto = first(headers.forwardedProto)?.toLowerCase()
  const scheme = proto === 'http' || proto === 'https' ? proto : new URL(configured).protocol.slice(0, -1)
  const forwardedHost = first(headers.forwardedHost)
  const fromForwarded = forwardedHost === undefined ? undefined : originOf(`${scheme}://${forwardedHost}`)
  if (fromForwarded !== undefined) {
    return { origin: fromForwarded, source: 'forwarded' }
  }
  const host = first(headers.host)
  const fromHost = host === undefined ? undefined : originOf(`${scheme}://${host}`)
  return fromHost === undefined ? null : { origin: fromHost, source: 'host' }
}
