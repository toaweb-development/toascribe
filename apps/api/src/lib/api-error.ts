import type { ApiError } from '@toascribe/shared'

export function apiError(code: string, message: string, requestId: string | undefined): ApiError {
  return { error: { code, message, ...(requestId === undefined ? {} : { requestId }) } }
}
