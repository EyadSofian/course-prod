CREATE TYPE "public"."asset_kind" AS ENUM('deck_pptx', 'deck_pdf', 'slide_png', 'audio_mp3', 'audio_merged_mp3', 'lesson_mp4', 'srt', 'quiz_pdf', 'package_zip', 'source_file', 'source_text');--> statement-breakpoint
CREATE TYPE "public"."lesson_status" AS ENUM('DRAFT', 'INGESTED', 'SUMMARIZED', 'REVIEWED', 'DECK_READY', 'DECK_EXPORTED', 'NARRATED', 'ASSEMBLED', 'PUBLISHED', 'FAILED', 'BLOCKED_BUDGET');--> statement-breakpoint
CREATE TYPE "public"."pronunciation_scope" AS ENUM('global', 'course');--> statement-breakpoint
CREATE TYPE "public"."stage" AS ENUM('INGEST', 'SUMMARIZE', 'DECK', 'EXPORT', 'NARRATE', 'ASSEMBLE', 'PUBLISH');--> statement-breakpoint
CREATE TYPE "public"."stage_run_status" AS ENUM('running', 'succeeded', 'failed', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."target_market" AS ENUM('EG', 'KSA', 'GULF');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'producer');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"slide_id" text,
	"storage_key" text NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title_ar" text NOT NULL,
	"code" text NOT NULL,
	"target_market" "target_market" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lesson_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"lesson_json" jsonb NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"title_ar" text NOT NULL,
	"status" "lesson_status" DEFAULT 'DRAFT' NOT NULL,
	"current_stage" "stage",
	"source_file_key" text,
	"source_text_key" text,
	"source_char_count" integer,
	"lesson_json" jsonb,
	"lesson_version" integer DEFAULT 1 NOT NULL,
	"dokie_project_url" text,
	"error" text,
	"error_code" text,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pronunciations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term" text NOT NULL,
	"replacement" text NOT NULL,
	"note" text,
	"scope" "pronunciation_scope" DEFAULT 'global' NOT NULL,
	"course_id" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stage_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"stage" "stage" NOT NULL,
	"attempt" integer NOT NULL,
	"status" "stage_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"log" jsonb,
	"error_code" text,
	"cost_cents" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'producer' NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assets" ADD CONSTRAINT "assets_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "courses" ADD CONSTRAINT "courses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lesson_versions" ADD CONSTRAINT "lesson_versions_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lesson_versions" ADD CONSTRAINT "lesson_versions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lessons" ADD CONSTRAINT "lessons_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lessons" ADD CONSTRAINT "lessons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pronunciations" ADD CONSTRAINT "pronunciations_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pronunciations" ADD CONSTRAINT "pronunciations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stage_runs" ADD CONSTRAINT "stage_runs_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_lesson_kind_idx" ON "assets" USING btree ("lesson_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assets_lesson_kind_slide_idx" ON "assets" USING btree ("lesson_id","kind","slide_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "courses_code_idx" ON "courses" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lesson_versions_lesson_version_idx" ON "lesson_versions" USING btree ("lesson_id","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lessons_course_idx" ON "lessons" USING btree ("course_id","order_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lessons_status_idx" ON "lessons" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pronunciations_term_scope_idx" ON "pronunciations" USING btree ("term","scope","course_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stage_runs_lesson_idx" ON "stage_runs" USING btree ("lesson_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stage_runs_lesson_stage_attempt_idx" ON "stage_runs" USING btree ("lesson_id","stage","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_lower_idx" ON "users" USING btree ("email");