/**
 * What a failed API call looks like to the screens: one class, whatever went wrong. The API answers every error with
 * `{ error: { code, message, requestId } }` (shared `ApiError`); a call that never got an answer has no status.
 *
 * `code` is the API's stable code (`invalid_code`, `too_many_requests`, ...), or `network` / `timeout` / `unreadable`
 * when there was no usable answer. The API's own `message` is kept for the log, never shown (it is English and may name
 * fields); screens show `describeApiError()`.
 */
export class ApiRequestError extends Error {
  readonly status: number | undefined
  readonly code: string
  readonly requestId: string | undefined
  /** Seconds from `Retry-After` on a 429 (or 503); undefined when the header is missing or unreadable. */
  readonly retryAfterSeconds: number | undefined

  constructor(init: {
    status?: number
    code: string
    message?: string
    requestId?: string
    retryAfterSeconds?: number
  }) {
    super(init.message ?? init.code)
    this.name = 'ApiRequestError'
    this.status = init.status
    this.code = init.code
    this.requestId = init.requestId
    this.retryAfterSeconds = init.retryAfterSeconds
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `Retry-After` is delta-seconds or an HTTP date; the API sends seconds. A date, a negative or a silly number is ignored. */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined || !/^\d{1,7}$/.test(value.trim())) {
    return undefined
  }
  return Number(value.trim())
}

/** The part of an ofetch `FetchError` that is read here; a structural type, so a test needs no ofetch. */
interface FetchErrorLike {
  readonly name?: unknown
  readonly status?: unknown
  readonly data?: unknown
  readonly response?: { readonly headers?: { get(name: string): string | null } }
  readonly cause?: unknown
}

/** Turns whatever `$fetch` threw into an ApiRequestError. An ApiRequestError passes through unchanged. */
export function toApiRequestError(error: unknown): ApiRequestError {
  if (error instanceof ApiRequestError) {
    return error
  }
  const like: FetchErrorLike = isRecord(error) ? error : {}
  const status = typeof like.status === 'number' ? like.status : undefined
  if (status === undefined) {
    // No response: the connection failed, or ofetch gave up (`timeout` aborts the request).
    const name = isRecord(like.cause) ? like.cause.name : undefined
    const timedOut = name === 'AbortError' || name === 'TimeoutError'
    return new ApiRequestError({
      code: timedOut ? 'timeout' : 'network',
      message: error instanceof Error ? error.message : undefined,
    })
  }
  const retryAfterSeconds = parseRetryAfter(like.response?.headers?.get('retry-after'))
  const body = isRecord(like.data) && isRecord(like.data.error) ? like.data.error : undefined
  if (body === undefined || typeof body.code !== 'string' || body.code === '') {
    return new ApiRequestError({ status, code: 'unreadable', retryAfterSeconds })
  }
  return new ApiRequestError({
    status,
    code: body.code,
    message: typeof body.message === 'string' ? body.message : undefined,
    requestId: typeof body.requestId === 'string' ? body.requestId : undefined,
    retryAfterSeconds,
  })
}
