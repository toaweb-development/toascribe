-- M1.2, the media library (generated): the name a file had when it was uploaded, and the state of the worker's work on it (the sizes
-- are made by a job after the upload), and a prefix index so /uploads/<key> of a size finds its file. Existing rows (none before M1.2) count as ready.
ALTER TABLE "media" ADD COLUMN "file_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "processing" text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "processing_error" text;--> statement-breakpoint
CREATE INDEX "idx_media_storage_key_prefix" ON "media" USING btree ("storage_key" text_pattern_ops);--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "ck_media_processing" CHECK ("media"."processing" in ('pending', 'ready', 'failed'));