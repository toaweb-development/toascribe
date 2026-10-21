CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"nicename" text NOT NULL,
	"password_hash" text,
	"status" text NOT NULL,
	"locale" text,
	"profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_account_status" CHECK ("account"."status" in ('active', 'pending', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "account_role" (
	"account_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_account_role" PRIMARY KEY("account_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "app_password" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_used_ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_app_password_account_id_name" UNIQUE("account_id","name")
);
--> statement-breakpoint
CREATE TABLE "login_attempt" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"action" text NOT NULL,
	"ip" "inet" NOT NULL,
	"account_id" uuid,
	"succeeded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_login_attempt_action" CHECK ("login_attempt"."action" in ('login', 'mfa', 'register', 'password_lost', 'comment'))
);
--> statement-breakpoint
CREATE TABLE "mfa_credential" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"type" text NOT NULL,
	"name" text,
	"secret_encrypted" text,
	"issuer" text,
	"external_id" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confirmed_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_mfa_credential_type" CHECK ("mfa_credential"."type" in ('totp', 'passkey', 'oidc')),
	CONSTRAINT "ck_mfa_credential_shape" CHECK (case when "mfa_credential"."type" = 'totp' then "mfa_credential"."secret_encrypted" is not null and "mfa_credential"."issuer" is null and "mfa_credential"."external_id" is null else "mfa_credential"."secret_encrypted" is null and "mfa_credential"."issuer" is not null and "mfa_credential"."external_id" is not null end)
);
--> statement-breakpoint
CREATE TABLE "recovery_code" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_recovery_code_account_id_code_hash" UNIQUE("account_id","code_hash")
);
--> statement-breakpoint
CREATE TABLE "role" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"capabilities" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_role_slug" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_session_token_hash" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "block_note" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"content_id" uuid NOT NULL,
	"block_id" text NOT NULL,
	"account_id" uuid,
	"body" text NOT NULL,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"short_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "content_short_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"type" text NOT NULL,
	"locale" text NOT NULL,
	"translation_group" uuid,
	"slug" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"excerpt" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"status_before_trash" text,
	"password_hash" text,
	"sticky" boolean DEFAULT false NOT NULL,
	"comment_status" text NOT NULL,
	"menu_order" integer DEFAULT 0 NOT NULL,
	"template" text,
	"parent_id" uuid,
	"featured_media_id" uuid,
	"published_at" timestamp with time zone,
	"unpublish_at" timestamp with time zone,
	"workflow_state" text,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search" "tsvector" DEFAULT ''::tsvector NOT NULL,
	"legacy_wp_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_content_short_id" UNIQUE("short_id"),
	CONSTRAINT "uq_content_type_locale_parent_id_slug" UNIQUE NULLS NOT DISTINCT("type","locale","parent_id","slug"),
	CONSTRAINT "ck_content_slug" CHECK ("content"."slug" <> ''),
	CONSTRAINT "ck_content_status" CHECK ("content"."status" in ('draft', 'pending', 'future', 'publish', 'private', 'trash')),
	CONSTRAINT "ck_content_status_before_trash" CHECK ("content"."status_before_trash" in ('draft', 'pending', 'future', 'publish', 'private')),
	CONSTRAINT "ck_content_trash" CHECK (("content"."status" = 'trash') = ("content"."status_before_trash" is not null)),
	CONSTRAINT "ck_content_comment_status" CHECK ("content"."comment_status" in ('open', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "content_author" (
	"content_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_content_author" PRIMARY KEY("content_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "content_autosave" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"content_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_content_autosave_content_id_account_id" UNIQUE("content_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "content_draft" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"content_id" uuid NOT NULL,
	"account_id" uuid,
	"release_id" uuid,
	"workflow_state" text,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_content_draft_content_id" UNIQUE("content_id")
);
--> statement-breakpoint
CREATE TABLE "content_lock" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"content_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_content_lock_content_id" UNIQUE("content_id")
);
--> statement-breakpoint
CREATE TABLE "content_ref" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"content_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_content_id" uuid,
	"target_media_id" uuid,
	"target_url" text,
	"block_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_content_ref_kind" CHECK ("content_ref"."kind" in ('link', 'media', 'embed')),
	CONSTRAINT "ck_content_ref_target" CHECK (num_nonnulls("content_ref"."target_content_id", "content_ref"."target_media_id", "content_ref"."target_url") = 1)
);
--> statement-breakpoint
CREATE TABLE "content_revision" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"content_id" uuid NOT NULL,
	"account_id" uuid,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_type" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_content_type_key" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "field_group" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_field_group_key" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "template" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"theme" text NOT NULL,
	"type" text NOT NULL,
	"slug" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_template_theme_type_slug" UNIQUE("theme","type","slug"),
	CONSTRAINT "ck_template_type" CHECK ("template"."type" in ('template', 'template_part'))
);
--> statement-breakpoint
CREATE TABLE "content_term" (
	"content_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_content_term" PRIMARY KEY("content_id","term_id")
);
--> statement-breakpoint
CREATE TABLE "taxonomy" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"is_hierarchical" boolean DEFAULT false NOT NULL,
	"content_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_taxonomy_slug" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "term" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"taxonomy_id" uuid NOT NULL,
	"parent_id" uuid,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_term_taxonomy_id_slug" UNIQUE("taxonomy_id","slug")
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"alt" text DEFAULT '' NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"mime" text NOT NULL,
	"size" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"sha256" text NOT NULL,
	"focal_point" jsonb,
	"folder_id" uuid,
	"uploaded_by" uuid,
	"attached_to" uuid,
	"visibility" text DEFAULT 'public' NOT NULL,
	"variants" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_media_storage_key" UNIQUE("storage_key"),
	CONSTRAINT "ck_media_visibility" CHECK ("media"."visibility" in ('public', 'private')),
	CONSTRAINT "ck_media_sha256" CHECK ("media"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ck_media_size" CHECK ("media"."size" >= 0),
	CONSTRAINT "ck_media_dimensions" CHECK (("media"."width" is null) = ("media"."height" is null) and "media"."width" > 0 and "media"."height" > 0)
);
--> statement-breakpoint
CREATE TABLE "media_folder" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_media_folder_parent_id_name" UNIQUE NULLS NOT DISTINCT("parent_id","name")
);
--> statement-breakpoint
CREATE TABLE "media_term" (
	"media_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_media_term" PRIMARY KEY("media_id","term_id")
);
--> statement-breakpoint
CREATE TABLE "area" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"theme" text NOT NULL,
	"key" text NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_area_theme_key" UNIQUE("theme","key")
);
--> statement-breakpoint
CREATE TABLE "comment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"content_id" uuid NOT NULL,
	"parent_id" uuid,
	"account_id" uuid,
	"author" text DEFAULT '' NOT NULL,
	"author_email" text DEFAULT '' NOT NULL,
	"author_url" text DEFAULT '' NOT NULL,
	"ip" "inet",
	"user_agent" text DEFAULT '' NOT NULL,
	"type" text DEFAULT 'comment' NOT NULL,
	"body" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_comment_type" CHECK ("comment"."type" in ('comment', 'pingback', 'trackback')),
	CONSTRAINT "ck_comment_status" CHECK ("comment"."status" in ('pending', 'approved', 'spam', 'trash'))
);
--> statement-breakpoint
CREATE TABLE "global_set" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_global_set_key" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "menu" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_menu_slug" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "not_found_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"path" text NOT NULL,
	"hits" bigint DEFAULT 1 NOT NULL,
	"last_referrer" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_not_found_log_path" UNIQUE("path"),
	CONSTRAINT "ck_not_found_log_path" CHECK (char_length("not_found_log"."path") <= 2048)
);
--> statement-breakpoint
CREATE TABLE "oembed_cache" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"url" text NOT NULL,
	"data" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_oembed_cache_url" UNIQUE("url"),
	CONSTRAINT "ck_oembed_cache_url" CHECK (char_length("oembed_cache"."url") <= 2048)
);
--> statement-breakpoint
CREATE TABLE "pattern" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_synced" boolean DEFAULT false NOT NULL,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_pattern_slug" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "redirect" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"source" text NOT NULL,
	"target" text,
	"content_id" uuid,
	"status_code" integer DEFAULT 301 NOT NULL,
	"origin" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_redirect_source" UNIQUE("source"),
	CONSTRAINT "ck_redirect_source" CHECK (char_length("redirect"."source") <= 2048),
	CONSTRAINT "ck_redirect_status_code" CHECK ("redirect"."status_code" in (301, 302, 307, 308, 410)),
	CONSTRAINT "ck_redirect_origin" CHECK ("redirect"."origin" in ('manual', 'slug_change', 'import')),
	CONSTRAINT "ck_redirect_target" CHECK (case when "redirect"."status_code" = 410 then "redirect"."target" is null and "redirect"."content_id" is null else num_nonnulls("redirect"."target", "redirect"."content_id") = 1 end)
);
--> statement-breakpoint
CREATE TABLE "setting" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"autoload" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_setting_key" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "webhook" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"events" text[] DEFAULT '{}'::text[] NOT NULL,
	"secret_encrypted" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"response_status" integer,
	"error" text,
	"duration_ms" integer,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_webhook_delivery_status" CHECK ("webhook_delivery"."status" in ('pending', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "release" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"publish_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_release_status" CHECK ("release"."status" in ('open', 'scheduled', 'published', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "workflow" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_workflow_key" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid,
	"actor_type" text NOT NULL,
	"actor" text,
	"action" text NOT NULL,
	"object_type" text,
	"object_id" text,
	"old_value" jsonb,
	"new_value" jsonb,
	"reason" text,
	"source" text NOT NULL,
	"correlation_id" text,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_audit_log_actor_type" CHECK ("audit_log"."actor_type" in ('account', 'system', 'extension', 'ai')),
	CONSTRAINT "ck_audit_log_source" CHECK ("audit_log"."source" in ('admin', 'api', 'cli', 'job', 'setup'))
);
--> statement-breakpoint
CREATE TABLE "backup" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"type" text NOT NULL,
	"target" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"size" bigint,
	"location" text,
	"verified_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_backup_type" CHECK ("backup"."type" in ('scheduled', 'manual', 'pre_update')),
	CONSTRAINT "ck_backup_target" CHECK ("backup"."target" in ('local', 's3', 'sftp')),
	CONSTRAINT "ck_backup_status" CHECK ("backup"."status" in ('running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "consent" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"subject_key" text NOT NULL,
	"account_id" uuid,
	"category" text NOT NULL,
	"granted" boolean NOT NULL,
	"policy_version" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_consent_category" CHECK ("consent"."category" in ('necessary', 'preferences', 'statistics', 'marketing'))
);
--> statement-breakpoint
CREATE TABLE "extension_state" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"slug" text NOT NULL,
	"version" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approved_permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"auto_update" boolean DEFAULT false NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_extension_state_kind_slug" UNIQUE("kind","slug"),
	CONSTRAINT "ck_extension_state_kind" CHECK ("extension_state"."kind" in ('theme', 'plugin'))
);
--> statement-breakpoint
CREATE TABLE "privacy_request" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"type" text NOT NULL,
	"email" text NOT NULL,
	"account_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"token_hash" text,
	"confirmed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_privacy_request_token_hash" UNIQUE("token_hash"),
	CONSTRAINT "ck_privacy_request_type" CHECK ("privacy_request"."type" in ('export', 'erase')),
	CONSTRAINT "ck_privacy_request_status" CHECK ("privacy_request"."status" in ('pending', 'confirmed', 'failed', 'completed'))
);
--> statement-breakpoint
ALTER TABLE "account_role" ADD CONSTRAINT "fk_account_role_account_id" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_role" ADD CONSTRAINT "fk_account_role_role_id" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_password" ADD CONSTRAINT "fk_app_password_account_id" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_attempt" ADD CONSTRAINT "fk_login_attempt_account_id" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_credential" ADD CONSTRAINT "fk_mfa_credential_account_id" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_code" ADD CONSTRAINT "fk_recovery_code_account_id" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "fk_session_account_id" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_note" ADD CONSTRAINT "fk_block_note_content_id" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_note" ADD CONSTRAINT "fk_block_note_account_id" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "fk_content_parent_id" FOREIGN KEY ("parent_id") REFERENCES "public"."content"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "fk_content_featured_media_id" FOREIGN KEY ("featured_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_author" ADD CONSTRAINT "fk_content_author_content_id" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_author" ADD CONSTRAINT "fk_content_author_account_id" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_autosave" ADD CONSTRAINT "fk_content_autosave_content_id" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_autosave" ADD CONSTRAINT "fk_content_autosave_account_id" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_draft" ADD CONSTRAINT "fk_content_draft_content_id" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_draft" ADD CONSTRAINT "fk_content_draft_account_id" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_draft" ADD CONSTRAINT "fk_content_draft_release_id" FOREIGN KEY ("release_id") REFERENCES "public"."release"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_lock" ADD CONSTRAINT "fk_content_lock_content_id" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_lock" ADD CONSTRAINT "fk_content_lock_account_id" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_ref" ADD CONSTRAINT "fk_content_ref_content_id" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_ref" ADD CONSTRAINT "fk_content_ref_target_content_id" FOREIGN KEY ("target_content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_ref" ADD CONSTRAINT "fk_content_ref_target_media_id" FOREIGN KEY ("target_media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_revision" ADD CONSTRAINT "fk_content_revision_content_id" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_revision" ADD CONSTRAINT "fk_content_revision_account_id" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_term" ADD CONSTRAINT "fk_content_term_content_id" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_term" ADD CONSTRAINT "fk_content_term_term_id" FOREIGN KEY ("term_id") REFERENCES "public"."term"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term" ADD CONSTRAINT "fk_term_taxonomy_id" FOREIGN KEY ("taxonomy_id") REFERENCES "public"."taxonomy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term" ADD CONSTRAINT "fk_term_parent_id" FOREIGN KEY ("parent_id") REFERENCES "public"."term"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "fk_media_folder_id" FOREIGN KEY ("folder_id") REFERENCES "public"."media_folder"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "fk_media_uploaded_by" FOREIGN KEY ("uploaded_by") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "fk_media_attached_to" FOREIGN KEY ("attached_to") REFERENCES "public"."content"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_folder" ADD CONSTRAINT "fk_media_folder_parent_id" FOREIGN KEY ("parent_id") REFERENCES "public"."media_folder"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_term" ADD CONSTRAINT "fk_media_term_media_id" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_term" ADD CONSTRAINT "fk_media_term_term_id" FOREIGN KEY ("term_id") REFERENCES "public"."term"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "fk_comment_content_id" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "fk_comment_parent_id" FOREIGN KEY ("parent_id") REFERENCES "public"."comment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "fk_comment_account_id" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redirect" ADD CONSTRAINT "fk_redirect_content_id" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "fk_webhook_delivery_webhook_id" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhook"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release" ADD CONSTRAINT "fk_release_account_id" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "fk_audit_log_account_id" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "fk_consent_account_id" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_request" ADD CONSTRAINT "fk_privacy_request_account_id" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_account_username" ON "account" USING btree (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "uq_account_email" ON "account" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "uq_account_nicename" ON "account" USING btree (lower("nicename"));--> statement-breakpoint
CREATE INDEX "idx_account_role_role_id" ON "account_role" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "idx_login_attempt_ip_created_at" ON "login_attempt" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "idx_login_attempt_account_id_created_at" ON "login_attempt" USING btree ("account_id","created_at") WHERE "login_attempt"."account_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_mfa_credential_identity" ON "mfa_credential" USING btree ("type","issuer","external_id") WHERE "mfa_credential"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_mfa_credential_account_id" ON "mfa_credential" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_session_account_id_expires_at" ON "session" USING btree ("account_id","expires_at");--> statement-breakpoint
CREATE INDEX "idx_session_expires_at" ON "session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_block_note_content_id" ON "block_note" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "idx_block_note_account_id" ON "block_note" USING btree ("account_id") WHERE "block_note"."account_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_content_type_status_published_at" ON "content" USING btree ("type","status","published_at");--> statement-breakpoint
CREATE INDEX "idx_content_parent_id" ON "content" USING btree ("parent_id") WHERE "content"."parent_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_content_featured_media_id" ON "content" USING btree ("featured_media_id") WHERE "content"."featured_media_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_content_fields" ON "content" USING gin ("fields" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "idx_content_blocks" ON "content" USING gin ("blocks" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "idx_content_search" ON "content" USING gin ("search");--> statement-breakpoint
CREATE INDEX "idx_content_author_account_id" ON "content_author" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_content_autosave_account_id" ON "content_autosave" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_content_draft_account_id" ON "content_draft" USING btree ("account_id") WHERE "content_draft"."account_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_content_draft_release_id" ON "content_draft" USING btree ("release_id") WHERE "content_draft"."release_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_content_lock_account_id" ON "content_lock" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_content_ref_content_id" ON "content_ref" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "idx_content_ref_target_content_id" ON "content_ref" USING btree ("target_content_id") WHERE "content_ref"."target_content_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_content_ref_target_media_id" ON "content_ref" USING btree ("target_media_id") WHERE "content_ref"."target_media_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_content_revision_content_id_created_at" ON "content_revision" USING btree ("content_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_content_revision_account_id" ON "content_revision" USING btree ("account_id") WHERE "content_revision"."account_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_content_term_term_id" ON "content_term" USING btree ("term_id");--> statement-breakpoint
CREATE INDEX "idx_term_parent_id" ON "term" USING btree ("parent_id") WHERE "term"."parent_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_media_folder_id" ON "media" USING btree ("folder_id") WHERE "media"."folder_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_media_uploaded_by" ON "media" USING btree ("uploaded_by") WHERE "media"."uploaded_by" is not null;--> statement-breakpoint
CREATE INDEX "idx_media_attached_to" ON "media" USING btree ("attached_to") WHERE "media"."attached_to" is not null;--> statement-breakpoint
CREATE INDEX "idx_media_term_term_id" ON "media_term" USING btree ("term_id");--> statement-breakpoint
CREATE INDEX "idx_comment_content_id_status" ON "comment" USING btree ("content_id","status");--> statement-breakpoint
CREATE INDEX "idx_comment_parent_id" ON "comment" USING btree ("parent_id") WHERE "comment"."parent_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_comment_account_id" ON "comment" USING btree ("account_id") WHERE "comment"."account_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_redirect_content_id" ON "redirect" USING btree ("content_id") WHERE "redirect"."content_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_webhook_delivery_webhook_id_created_at" ON "webhook_delivery" USING btree ("webhook_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_release_account_id" ON "release" USING btree ("account_id") WHERE "release"."account_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_audit_log_created_at" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_log_account_id" ON "audit_log" USING btree ("account_id") WHERE "audit_log"."account_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_consent_account_id" ON "consent" USING btree ("account_id") WHERE "consent"."account_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_privacy_request_account_id" ON "privacy_request" USING btree ("account_id") WHERE "privacy_request"."account_id" is not null;--> statement-breakpoint
-- Written by hand (drizzle-kit does not manage privileges). audit_log is append-only for the app role
-- (SECURITY_STANDARD §8): init.sql's default privileges give it SELECT, INSERT, UPDATE and DELETE on every new table,
-- so UPDATE and DELETE are taken back here. UPDATE stays on the one column the 90-day job clears (ip). ON DELETE SET NULL
-- from account still works: referential actions run as the table owner. The role is named in docker/postgres/init.sql;
-- a database set up without it (no app role yet) has nothing to revoke.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'toascribe_app') THEN
    REVOKE UPDATE, DELETE ON TABLE "audit_log" FROM toascribe_app;
    GRANT UPDATE ("ip") ON TABLE "audit_log" TO toascribe_app;
  END IF;
END
$$;
