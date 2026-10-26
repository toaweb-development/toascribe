-- M1.1, the content API (generated; the DELETE is added by hand).
--
-- 1. Three partial indexes for the worker: the scheduler's two lookups every minute (scheduled items whose time has come,
--    published ones whose unpublish time has passed) and the daily purge of items trashed more than 30 days ago.
CREATE INDEX "idx_content_published_at_future" ON "content" USING btree ("published_at") WHERE "content"."status" = 'future';--> statement-breakpoint
CREATE INDEX "idx_content_unpublish_at" ON "content" USING btree ("unpublish_at") WHERE "content"."unpublish_at" is not null;--> statement-breakpoint
CREATE INDEX "idx_content_modified_at_trash" ON "content" USING btree ("modified_at") WHERE "content"."status" = 'trash';--> statement-breakpoint
-- 2. The editor prototype of M0.6 saved one draft post per account (slug editor-prototype-<account id>, title «Editor prototype»).
--    The editor now saves through the content API, so these drafts are left-overs that would show in «Alle innlegg». Only rows that
--    match all of the prototype's marks are deleted, and only when the account in the slug is one of the item's authors; their
--    content_author rows go with them (ON DELETE CASCADE). Throw-away test data, so no audit entry. On a new database it does nothing.
DELETE FROM "content" AS c
WHERE c."type" = 'post'
  AND c."title" = 'Editor prototype'
  AND c."status" = 'draft'
  AND c."slug" ~ '^editor-prototype-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND EXISTS (
    SELECT 1 FROM "content_author" AS a
    WHERE a."content_id" = c."id" AND a."account_id"::text = substr(c."slug", length('editor-prototype-') + 1)
  );
