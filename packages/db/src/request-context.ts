// The request id of what is running now (M1.8, K-297), so a job queued while the api answers a request carries the id the site
// gave that request, and the worker's lines about the job can be found with it. Set by the api for each request.
import { AsyncLocalStorage } from 'node:async_hooks'

import { REQUEST_ID_PATTERN } from '@toascribe/shared'

const store = new AsyncLocalStorage<{ readonly requestId: string }>()

/** Runs `fn` with this request id as the current one. */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return store.run({ requestId }, fn)
}

/** The current request id, or undefined outside a request. */
export function currentRequestId(): string | undefined {
  return store.getStore()?.requestId
}

/** The job data with the current request id added, when there is one (the worker takes it out before it reads the job). */
export function withRequestId<T extends object>(data: T): T & { requestId?: string } {
  const requestId = currentRequestId()
  return requestId === undefined ? data : { ...data, requestId }
}

/** A job's request id and its data without it. An id that is not one (an old job, a hand-made one) is dropped. */
export function takeRequestId(data: unknown): { requestId: string | undefined; data: unknown } {
  if (typeof data !== 'object' || data === null || !('requestId' in data)) return { requestId: undefined, data }
  const { requestId, ...rest } = data as Record<string, unknown>
  return {
    requestId: typeof requestId === 'string' && REQUEST_ID_PATTERN.test(requestId) ? requestId : undefined,
    data: rest,
  }
}
