import "server-only";
import { desc, eq, or } from "drizzle-orm";
import {
  assets,
  courses,
  getDb,
  lessons,
  pronunciations,
  stageRuns,
} from "@course-prod/core/db";

/**
 * Read-side queries. Kept out of actions.ts because a "use server" module
 * compiles every export into a callable server action — these are plain
 * server-side reads and should not be reachable from the client.
 */

export async function listCourses() {
  return getDb()
    .select({ id: courses.id, titleAr: courses.titleAr, code: courses.code, market: courses.targetMarket })
    .from(courses)
    .orderBy(courses.titleAr);
}

export async function getLesson(id: string) {
  const [row] = await getDb()
    .select({
      lesson: lessons,
      courseTitle: courses.titleAr,
      courseCode: courses.code,
      market: courses.targetMarket,
    })
    .from(lessons)
    .leftJoin(courses, eq(lessons.courseId, courses.id))
    .where(eq(lessons.id, id))
    .limit(1);
  return row ?? null;
}

export async function getStageRuns(lessonId: string) {
  return getDb()
    .select()
    .from(stageRuns)
    .where(eq(stageRuns.lessonId, lessonId))
    .orderBy(desc(stageRuns.startedAt))
    .limit(60);
}

export async function getAssets(lessonId: string) {
  return getDb()
    .select()
    .from(assets)
    .where(eq(assets.lessonId, lessonId))
    .orderBy(assets.kind, assets.slideId);
}

export async function listDictionary(courseId?: string) {
  const db = getDb();
  const rows = courseId
    ? await db
        .select()
        .from(pronunciations)
        .where(or(eq(pronunciations.scope, "global"), eq(pronunciations.courseId, courseId)))
    : await db.select().from(pronunciations);

  return rows.sort((a, b) => a.term.localeCompare(b.term, "ar"));
}
