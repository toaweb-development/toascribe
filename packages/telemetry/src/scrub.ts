// The log's rules for traces (M1.8, K-298): before a span is exported, every attribute whose name is on the fixed list (by its last
// part: `http.request.header.cookie` is `cookie`) is hidden, the query string of every address is dropped (it can carry tokens), and
// every other string is scrubbed of e-mail addresses and credentials. The same for the attributes of the span's events.
import type { AttributeValue, Attributes } from '@opentelemetry/api'
import type { Span, SpanProcessor } from '@opentelemetry/sdk-trace'
import { LOG_REDACTED, isRedactedField, scrubLogText } from '@toascribe/shared'

/** Attributes that hold an address or its query: the query goes, the rest stays (`/api/v1/content?[skjult]`). */
const ADDRESS_KEYS = new Set(['url.full', 'url.query', 'http.url', 'http.target', 'url.original'])

function withoutQuery(value: string, key: string): string {
  if (key === 'url.query') return value === '' ? value : LOG_REDACTED
  const at = value.indexOf('?')
  return at === -1 ? scrubLogText(value) : `${scrubLogText(value.slice(0, at))}?${LOG_REDACTED}`
}

export function scrubAttribute(key: string, value: AttributeValue): AttributeValue {
  if (isRedactedField(key.split('.').pop() ?? key)) return LOG_REDACTED
  if (typeof value === 'string') return ADDRESS_KEYS.has(key) ? withoutQuery(value, key) : scrubLogText(value)
  if (Array.isArray(value))
    return value.map((entry) => (typeof entry === 'string' ? scrubLogText(entry) : entry)) as AttributeValue
  return value
}

/** A copy of the attributes with the rules applied. */
export function scrubAttributes(attributes: Attributes): Attributes {
  const out: Attributes = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) out[key] = scrubAttribute(key, value)
  }
  return out
}

/** Applies the rules while the span can still be changed (the SDK's `onEnding`, before `onEnd` and the export). */
export function scrubSpan(span: Span): void {
  for (const [key, value] of Object.entries(span.attributes)) {
    if (value === undefined) continue
    const next = scrubAttribute(key, value)
    if (next !== value) span.setAttribute(key, next)
  }
  for (const event of span.events) {
    if (event.attributes === undefined) continue
    const scrubbed = scrubAttributes(event.attributes)
    for (const key of Object.keys(scrubbed))
      (event.attributes as Record<string, AttributeValue | undefined>)[key] = scrubbed[key]
  }
}

/** The processor that scrubs: first in the list, so the exporting processor sees only what it left. */
export function scrubbingSpanProcessor(): SpanProcessor {
  return {
    onStart: () => undefined,
    onEnding: scrubSpan,
    onEnd: () => undefined,
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  }
}
