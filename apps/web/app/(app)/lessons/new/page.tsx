import { listCourses } from "@/lib/queries";
import { NewLessonForm } from "./form";
import { CourseForm } from "./course-form";

export const dynamic = "force-dynamic";

export default async function NewLessonPage() {
  const courses = await listCourses();

  return (
    <>
      <div className="page-head">
        <h1>درس جديد</h1>
      </div>

      <div style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(0,1fr) 320px" }}>
        <div className="card">
          {courses.length === 0 ? (
            <p className="muted" style={{ marginBlockStart: 0 }}>
              أضف كورساً أولاً من اللوحة المجاورة، ثم ارفع المادة العلمية.
            </p>
          ) : (
            <NewLessonForm courses={courses} />
          )}
        </div>

        <div className="card">
          <h2 style={{ marginBlockEnd: 12 }}>كورس جديد</h2>
          <CourseForm />
        </div>
      </div>
    </>
  );
}
