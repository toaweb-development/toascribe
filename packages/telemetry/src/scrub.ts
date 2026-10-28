// The log's rules for traces (M1.8, K-298): before a span is exported, every attribute whose name is on the fixed list (by its last
// part: `http.request.header.cookie` is `cookie`) is hidden, the query string of every address is dropped (it can carry tokens), and
// every other string is scrubbed of e-mail addresses and credentials. The same for the attributes of the span's events.
import type { Span, SpanProcessor } from '@opentelemetry/sdk-trace'
import { LOG_REDACTED, isRedactedField, scrubLogText } from '@toascribe/shared'

/** Attributes that hold an address or its query: the query goes, the rest stays (`/api/v1/content?[skjult]`). */
const ADDRESS_KEYS = new Set(['url.full', 'url.query', 'http.url', 'http.target', 'url.original'])

function withoutQuery(value: string, key: string): string {
  if (key === 'url.query') return value === '' ? value : LOG_REDACTED
  const at = value.indexOf('?')
  return at === -1 ? scrubLogText(value) : `${scrubLogText(value.slice(0, at))}?${LOG_REDACTED}`
}

/** One attribute's value with the rules applied; anything that is not a string (or a list of them) stays as it was. */
export function scrubAttribute(key: string, value: unknown): unknown {
  if (isRedactedField(key.split('.').pop() ?? key)) return LOG_REDACTED
  if (typeof value === 'string') return ADDRESS_KEYS.has(key) ? withoutQuery(value, key) : scrubLogText(value)
  if (Array.isArray(value)) {
    const entries: unknown[] = value
    return entries.map((entry) => (typeof entry === 'string' ? scrubLogText(entry) : entry))
  }
  return value
}

/** Applies the rules to a record of attributes, in place. */
function scrubRecord(attributes: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) attributes[key] = scrubAttribute(key, value)
  }
}

/** Applies the rules while the span can still be changed (the SDK's `onEnding`, before `onEnd` and the export). */
export function scrubSpan(span: Span): void {
  const attributes: Record<string, unknown> = { ...span.attributes }
  scrubRecord(attributes)
  // The span's own setter keeps its limits and checks; an attribute set to the same value is left alone.
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== span.attributes[key]) {
      span.setAttribute(key, value)
    }
  }
  for (const event of span.events) {
    if (event.attributes !== undefined) scrubRecord(event.attributes)
  }
}

/** The processor that scrubs: first in the list, so the exporting processor sees only what it left. */
export function scrubbingSpanProcessor(): SpanProcessor {
  return {
    onStart: () => undefined,
    onEnding: (span) => {
      scrubSpan(span)
    },
    onEnd: () => undefined,
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  }
}
