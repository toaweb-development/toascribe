import { z } from 'zod'

import { AdminNoticeLevel } from './values.ts'

// The dashboard (M0.5): «I korte trekk» and the notices.

/**
 * GET /dashboard/glance (WordPress' «At a Glance»). A count is left out, not 0, when the account may not see it:
 * `posts` needs `edit_posts`, `pages` needs `edit_pages`, `comments` needs `moderate_comments`.
 */
export const GlanceResponse = z.object({
  /** Published posts. */
  posts: z.int().min(0).optional(),
  /** Published pages. */
  pages: z.int().min(0).optional(),
  comments: z.object({ approved: z.int().min(0), pending: z.int().min(0) }).optional(),
  /** The version of the running api (the repo version). */
  version: z.string(),
})
export type GlanceResponse = z.infer<typeof GlanceResponse>

/**
 * The values a notice's message interpolates. Plain values only (text, numbers, booleans): the OpenAPI document cannot describe
 * the open JSON of `admin_notice.data`, and a message has no use for a nested value.
 */
export const NoticeData = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
export type NoticeData = z.infer<typeof NoticeData>

/** One notice as the dashboard shows it. The text is the admin's i18n `messageKey`, interpolated with `data`. */
export const Notice = z.object({
  key: z.string(),
  level: AdminNoticeLevel,
  messageKey: z.string(),
  data: NoticeData,
  isDismissible: z.boolean(),
})
export type Notice = z.infer<typeof Notice>

/** GET /notices: the notices the account may see, most severe first. */
export const NoticeListResponse = z.object({ notices: z.array(Notice) })
export type NoticeListResponse = z.infer<typeof NoticeListResponse>

export const NoticeKeyParams = z.object({
  key: z
    .string()
    .max(100)
    .regex(/^[a-z0-9_.-]+$/),
})
export type NoticeKeyParams = z.infer<typeof NoticeKeyParams>
