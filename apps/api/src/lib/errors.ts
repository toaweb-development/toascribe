// Typed errors thrown from the service layer; app.onError maps them to the ApiError format
// (typescript §8). The message of an AppError is shown to the client, so it must be safe.
import { MAX_BLOCK_ISSUES } from '@toascribe/shared'
import type { BlockIssue } from '@toascribe/shared'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export class AppError extends Error {
  readonly status: ContentfulStatusCode
  readonly code: string

  constructor(status: ContentfulStatusCode, code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
    this.status = status
    this.code = code
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', options?: ErrorOptions) {
    super(404, 'not_found', message, options)
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', options?: ErrorOptions) {
    super(403, 'forbidden', message, options)
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', options?: ErrorOptions) {
    super(409, 'conflict', message, options)
  }
}

/** No valid session (or the wrong credentials). The message must not say which part was wrong. */
export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', code = 'unauthorized', options?: ErrorOptions) {
    super(401, code, message, options)
  }
}

/** A rate limit or a lockout. `retryAfterSeconds` becomes the Retry-After header. */
export class TooManyRequestsError extends AppError {
  readonly retryAfterSeconds: number

  constructor(retryAfterSeconds: number, message = 'Too many attempts. Try again later.', options?: ErrorOptions) {
    super(429, 'too_many_requests', message, options)
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds))
  }
}

/** A request the api refuses to read in this form (wrong content type, cross-site origin). */
export class BadRequestError extends AppError {
  constructor(message = 'Bad request', code = 'bad_request', options?: ErrorOptions) {
    super(400, code, message, options)
  }
}

/** 400 with the issues found in a block document. */
export class InvalidBlocksError extends AppError {
  readonly issues: readonly BlockIssue[]

  constructor(issues: readonly BlockIssue[]) {
    super(400, 'invalid_blocks', 'The blocks do not match their block.json')
    this.issues = issues.slice(0, MAX_BLOCK_ISSUES)
  }
}
