-- M1.5 (generated): a global set's blocks (K-106), edited with the block editor. Additive. Downgrade (drizzle runs forward only):
--   ALTER TABLE "global_set" DROP COLUMN "blocks";
ALTER TABLE "global_set" ADD COLUMN "blocks" jsonb DEFAULT '[]'::jsonb NOT NULL;