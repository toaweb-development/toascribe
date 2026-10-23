import type { Context, ErrorHandler, NotFoundHandler } from 'hono'
import { AlreadyInstalledError, InstallError } from '@toascribe/install'
import type { InstallErrorCode } from '@toascribe/install'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import { apiError } from '../lib/api-error.ts'
import type { AppEnv } from '../lib/env.ts'
import { AppError, TooManyRequestsError } from '../lib/errors.ts'

const CODE_BY_STATUS: Readonly<Record<number, string>> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  422: 'unprocessable_entity',
  429: 'too_many_requests',
}

/** What each refusal of the install service is to an HTTP client. The messages of InstallError are safe to show (they name steps and fields). */
const INSTALL_STATUS: Readonly<Record<InstallErrorCode, ContentfulStatusCode>> = {
  step_missing: 409,
  username_taken: 409,
  email_taken: 409,
  recovery_key_mismatch: 400,
  content_exists: 409,
  invalid_input: 400,
}

/** A response in the common ApiError format. */
export function errorResponse(c: Context<AppEnv>, status: ContentfulStatusCode, code: string, message: string) {
  return c.json(apiError(code, message, c.get('requestId')), status)
}

/**
 * The single error handler (typescript §8). Typed errors and 4xx HTTP exceptions become an
 * ApiError with a message that is safe to show. Everything else is a 500 with a fixed text; the
 * error, stack included, goes to the log only, tagged with the request id.
 */
export const onError: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof AppError) {
    if (err instanceof TooManyRequestsError) {
      c.header('Retry-After', String(err.retryAfterSeconds))
    }
    return errorResponse(c, err.status, err.code, err.message)
  }
  if (err instanceof AlreadyInstalledError) {
    return errorResponse(c, 409, 'already_installed', 'The site is already installed')
  }
  if (err instanceof InstallError) {
    return errorResponse(c, INSTALL_STATUS[err.code], err.code, err.message)
  }
  if (err instanceof HTTPException && err.status >= 400 && err.status < 500) {
    return errorResponse(
      c,
      err.status,
      CODE_BY_STATUS[err.status] ?? 'bad_request',
      err.message === '' ? 'Bad request' : err.message,
    )
  }
  c.get('logger').error({ err }, 'unhandled error')
  return errorResponse(c, 500, 'internal_error', 'Internal server error')
}

export const onNotFound: NotFoundHandler<AppEnv> = (c) => errorResponse(c, 404, 'not_found', 'Not found')
