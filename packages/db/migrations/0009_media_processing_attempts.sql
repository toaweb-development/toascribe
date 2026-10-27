-- Review M6 of M1.2 (generated): the worker's runs per file since the last upload, replacement, edit or «Lag bildestørrelser på nytt».
-- After three the file is `failed` and is not queued again. Additive; existing rows start at 0. Downgrade (drizzle runs forward only):
--   ALTER TABLE "media" DROP CONSTRAINT "ck_media_processing_attempts"; ALTER TABLE "media" DROP COLUMN "processing_attempts";
ALTER TABLE "media" ADD COLUMN "processing_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "ck_media_processing_attempts" CHECK ("media"."processing_attempts" >= 0);