import { z } from 'zod'

// POST /api/v1/system/test-email (K-204): an administrator asks for a test mail to see that the SMTP settings work.

export const TestEmailRequest = z.strictObject({
  /** Where to send it. Default: the signed-in account's own address. */
  to: z.email().max(254).optional(),
})
export type TestEmailRequest = z.infer<typeof TestEmailRequest>

/** 202: the mail is queued, not yet sent. `jobId` is the queue's id for it (for the logs). */
export const TestEmailResponse = z.object({ jobId: z.string().min(1) })
export type TestEmailResponse = z.infer<typeof TestEmailResponse>
