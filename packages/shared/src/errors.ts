import { z } from 'zod'

/**
 * The one error format of the API (typescript §8). `code` is a stable machine-readable string
 * (snake_case), `message` is safe to show, `requestId` matches the X-Request-Id response header
 * and the log lines. Stack traces, SQL and internal details never appear here.
 */
export const ApiError = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
    requestId: z.string().optional(),
    /**
     * Only with TOASCRIBE_DEBUG=1 on the server, and only on a 500 (M1.8, K-297): the kind of error (its class and, for a
     * database error, the SQLSTATE). Never a message, a stack or a value; the log has the rest under the request id.
     */
    debug: z.object({ kind: z.string(), code: z.string().optional() }).optional(),
  }),
})
export type ApiError = z.infer<typeof ApiError>
