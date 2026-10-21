// Releases and editorial workflows (K-101 phase 4, K-097 phase 3): room in the model, no behaviour yet.
import { sql } from 'drizzle-orm'
import { RELEASE_STATUS } from '@toascribe/shared'
import type { WorkflowSteps } from '@toascribe/shared'
import { boolean, check, foreignKey, index, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'
import type { PgTableExtraConfigValue } from 'drizzle-orm/pg-core'

import { account } from './accounts.ts'
import { id, oneOf, timestamps, timestamptz } from './columns.ts'

/** A release: drafts of several items published together at one time (content_draft.release_id). */
export const release = pgTable(
  'release',
  {
    id: id(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').notNull().default('open'),
    publishAt: timestamptz('publish_at'),
    publishedAt: timestamptz('published_at'),
    /** Who made it. */
    accountId: uuid('account_id'),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    check('ck_release_status', oneOf(t.status, RELEASE_STATUS)),
    // A release stays when the account that made it is deleted.
    foreignKey({ name: 'fk_release_account_id', columns: [t.accountId], foreignColumns: [account.id] }).onDelete(
      'set null',
    ),
    index('idx_release_account_id')
      .on(t.accountId)
      .where(sql`${t.accountId} is not null`),
  ],
)

/** An editorial workflow with steps (e.g. Draft, Proofreading, Approved) for some content types. */
export const workflow = pgTable(
  'workflow',
  {
    id: id(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    /** Ordered steps; content.workflow_state and content_draft.workflow_state hold a step key. */
    steps: jsonb('steps').$type<WorkflowSteps>().notNull().default([]),
    contentTypes: text('content_types')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [unique('uq_workflow_key').on(t.key)],
)
