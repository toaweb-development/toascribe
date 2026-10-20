// Typed errors thrown from the service layer; app.onError maps them to the ApiError format
// (typescript §8). The message of an AppError is shown to the client, so it must be safe.
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
