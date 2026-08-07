import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { LESSON_STATUSES, STAGES, STAGE_RUN_STATUSES } from "../stages.js";
import type { LessonJson } from "../schema/lesson.js";

/* ── enums ─────────────────────────────────────────────────────────────── */

export const targetMarketEnum = pgEnum("target_market", ["EG", "KSA", "GULF"]);
export const userRoleEnum = pgEnum("user_role", ["admin", "producer"]);
export const lessonStatusEnum = pgEnum("lesson_status", LESSON_STATUSES);
export const stageEnum = pgEnum("stage", STAGES);
export const stageRunStatusEnum = pgEnum("stage_run_status", STAGE_RUN_STATUSES);
export const assetKindEnum = pgEnum("asset_kind", [
  "deck_pptx",
  "deck_pdf",
  "slide_png",
  "audio_mp3",
  "audio_merged_mp3",
  "lesson_mp4",
  "srt",
  "quiz_pdf",
  "package_zip",
  "source_file",
  "source_text",
]);
export const pronunciationScopeEnum = pgEnum("pronunciation_scope", ["global", "course"]);

/* ── users ─────────────────────────────────────────────────────────────── */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: userRoleEnum("role").notNull().default("producer"),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Indexed on lower(email), not email: logins are typed by hand and
    // "Eyad@" must not become a second account alongside "eyad@". The app
    // normalises on both write paths, but the constraint should hold even if
    // a row is inserted directly.
    emailIdx: uniqueIndex("users_email_unique").on(sql`lower(${t.email})`),
  }),
);

/* ── courses ───────────────────────────────────────────────────────────── */

export const courses = pgTable(
  "courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    titleAr: text("title_ar").notNull(),
    code: text("code").notNull(),
    targetMarket: targetMarketEnum("target_market").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ codeIdx: uniqueIndex("courses_code_idx").on(t.code) }),
);

/* ── lessons ───────────────────────────────────────────────────────────── */

export const lessons = pgTable(
  "lessons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    orderIndex: integer("order_index").notNull().default(0),
    titleAr: text("title_ar").notNull(),
    status: lessonStatusEnum("status").notNull().default("DRAFT"),
    /** Set while a stage is running; null when idle. Drives the "جارٍ…" UI. */
    currentStage: stageEnum("current_stage"),
    sourceFileKey: text("source_file_key"),
    sourceTextKey: text("source_text_key"),
    sourceCharCount: integer("source_char_count"),
    /** The canonical artifact (§4). Validated with zod at every boundary. */
    lessonJson: jsonb("lesson_json").$type<LessonJson>(),
    /** Version counter for the §6.3 freeze: approving snapshots, editing bumps. */
    lessonVersion: integer("lesson_version").notNull().default(1),
    dokieProjectUrl: text("dokie_project_url"),
    /** Producer-facing failure text. Cleared on a successful re-run. */
    error: text("error"),
    errorCode: text("error_code"),
    costCents: integer("cost_cents").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    courseIdx: index("lessons_course_idx").on(t.courseId, t.orderIndex),
    statusIdx: index("lessons_status_idx").on(t.status),
  }),
);

/**
 * Frozen snapshots of lesson_json (§6.3). Approving writes version N; editing
 * an approved lesson writes N+1 and leaves the approved copy intact, so an
 * in-flight production run always has the exact bytes it started from.
 */
export const lessonVersions = pgTable(
  "lesson_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    lessonJson: jsonb("lesson_json").$type<LessonJson>().notNull(),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lessonVersionIdx: uniqueIndex("lesson_versions_lesson_version_idx").on(t.lessonId, t.version),
  }),
);

/* ── assets ────────────────────────────────────────────────────────────── */

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    kind: assetKindEnum("kind").notNull(),
    /** Non-null for per-slide assets (slide_png, audio_mp3). Matches slides[].id. */
    slideId: text("slide_id"),
    storageKey: text("storage_key").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lessonKindIdx: index("assets_lesson_kind_idx").on(t.lessonId, t.kind),
    // Re-generating one slide replaces exactly one row (§6.6) instead of
    // appending a duplicate the assembler would have to disambiguate.
    //
    // nullsNotDistinct is load-bearing: slide_id is NULL for every whole-lesson
    // asset (deck_pptx, lesson_mp4, package_zip …), and Postgres's default
    // treats each NULL as distinct — so without it this constraint silently
    // permits exactly the duplicates it exists to prevent, for the majority of
    // asset kinds. Requires Postgres 15+.
    uniquePerSlide: unique("assets_lesson_kind_slide_uq")
      .on(t.lessonId, t.kind, t.slideId)
      .nullsNotDistinct(),
  }),
);

/* ── pronunciations ────────────────────────────────────────────────────── */

/**
 * §3 writes scope as ('global'|course_id). Modelled here as an explicit enum
 * plus a nullable FK so the database can enforce that a course-scoped row
 * actually points at a live course.
 */
export const pronunciations = pgTable(
  "pronunciations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    term: text("term").notNull(),
    replacement: text("replacement").notNull(),
    note: text("note"),
    scope: pronunciationScopeEnum("scope").notNull().default("global"),
    courseId: uuid("course_id").references(() => courses.id, { onDelete: "cascade" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    termScopeIdx: uniqueIndex("pronunciations_term_scope_idx").on(t.term, t.scope, t.courseId),
  }),
);

/* ── stage_runs ────────────────────────────────────────────────────────── */

/**
 * One row per attempt. §3 calls this not optional: without it, debugging a
 * failed lesson is guesswork.
 */
export const stageRuns = pgTable(
  "stage_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    stage: stageEnum("stage").notNull(),
    attempt: integer("attempt").notNull(),
    status: stageRunStatusEnum("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Free-form structured log: raw model output, ffmpeg stderr, screenshot paths. */
    log: jsonb("log").$type<Record<string, unknown>>(),
    errorCode: text("error_code"),
    costCents: integer("cost_cents").notNull().default(0),
  },
  (t) => ({
    lessonIdx: index("stage_runs_lesson_idx").on(t.lessonId, t.startedAt),
    attemptIdx: uniqueIndex("stage_runs_lesson_stage_attempt_idx").on(
      t.lessonId,
      t.stage,
      t.attempt,
    ),
  }),
);

/* ── settings ──────────────────────────────────────────────────────────── */

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Course = typeof courses.$inferSelect;
export type Lesson = typeof lessons.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type Pronunciation = typeof pronunciations.$inferSelect;
export type StageRun = typeof stageRuns.$inferSelect;
