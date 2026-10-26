// «I korte trekk» (WordPress' At a Glance, `wp_dashboard_right_now()`): what the site holds, as much of it as the account may see.
// The rule is WordPress': the post count is for those who can `edit_posts`, the page count for `edit_pages`, the comment counts for
// `moderate_comments`. A count the account may not see is left out, not shown as 0. The version is shown to everyone who can
// see the dashboard (the api reports it on /api/health already). The active theme is left out: no setting holds it yet.
import type { Database } from '@toascribe/db'
import type { GlanceResponse } from '@toascribe/shared'

import type { SessionAuth } from '../lib/auth-context.ts'
import { countComments } from '../repositories/dashboard.ts'
import type { ContentService } from './content.ts'

export interface DashboardService {
  glance: (auth: SessionAuth) => Promise<GlanceResponse>
}

export function createDashboardService(options: {
  readonly db: Database
  readonly version: string
  /** The post and page counts are the content API's own (the «Publisert» view of each list). */
  readonly content: Pick<ContentService, 'counts'>
}): DashboardService {
  const { db, version, content } = options
  return {
    async glance(auth) {
      const can = (capability: string) => auth.capabilities.has(capability)
      const [posts, pages, approved, pending] = await Promise.all([
        content.counts(auth, 'post').then((counts) => counts?.publish),
        content.counts(auth, 'page').then((counts) => counts?.publish),
        can('moderate_comments') ? countComments(db, 'approved') : undefined,
        can('moderate_comments') ? countComments(db, 'pending') : undefined,
      ])
      return {
        ...(posts === undefined ? {} : { posts }),
        ...(pages === undefined ? {} : { pages }),
        ...(approved === undefined || pending === undefined ? {} : { comments: { approved, pending } }),
        version,
      }
    },
  }
}
