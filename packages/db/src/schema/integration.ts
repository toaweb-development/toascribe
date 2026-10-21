// Outgoing webhooks and their delivery log (K-177; security standard «Webhooks»: HMAC-SHA256 over the raw body).
import { sql } from 'drizzle-orm'
import { WEBHOOK_DELIVERY_STATUS } from '@toascribe/shared'
import type { WebhookPayload } from '@toascribe/shared'
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import type { PgTableExtraConfigValue } from 'drizzle-orm/pg-core'

import { id, oneOf, timestamps, timestamptz } from './columns.ts'

/** A webhook: events sent to a URL, signed with its own secret. */
export const webhook = pgTable('webhook', {
  id: id(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  /** Event names (content.published, comment.created, ...). Extensions add events, so there is no CHECK. */
  events: text('events')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  /** The signing secret, encrypted with the site key (K-318). It must be readable to sign, so it is not a hash. */
  secretEncrypted: text('secret_encrypted').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps(),
})

/** One event sent to one webhook; retries update the same row. Its id is the idempotency key the receiver sees. */
export const webhookDelivery = pgTable(
  'webhook_delivery',
  {
    id: id(),
    webhookId: uuid('webhook_id').notNull(),
    event: text('event').notNull(),
    payload: jsonb('payload').$type<WebhookPayload>().notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    responseStatus: integer('response_status'),
    /** Error text or the start of the response body, cut short by the service. */
    error: text('error'),
    durationMs: integer('duration_ms'),
    deliveredAt: timestamptz('delivered_at'),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    check('ck_webhook_delivery_status', oneOf(t.status, WEBHOOK_DELIVERY_STATUS)),
    // The log goes with its webhook.
    foreignKey({
      name: 'fk_webhook_delivery_webhook_id',
      columns: [t.webhookId],
      foreignColumns: [webhook.id],
    }).onDelete('cascade'),
    // GET /webhooks/{id}/deliveries, newest first.
    index('idx_webhook_delivery_webhook_id_created_at').on(t.webhookId, t.createdAt),
  ],
)
