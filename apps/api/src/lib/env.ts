import type { Logger } from 'pino'

/** The Hono environment: what middleware puts on the context. */
export interface AppEnv {
  Variables: {
    /** Set by hono/request-id. */
    requestId: string
    /** A child logger carrying the request id; set by the request-logger middleware. */
    logger: Logger
  }
}
