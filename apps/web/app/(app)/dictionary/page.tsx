import { TTS_USD_PER_1K_CHARS } from "@course-prod/core/settings";
import { loadSettings } from "@course-prod/core/settings-store";
import { listCourses, listDictionary } from "@/lib/queries";
import { DictionaryTable } from "./table";

export const dynamic = "force-dynamic";

export default async function DictionaryPage() {
  const [entries, courses, settings] = await Promise.all([
    listDictionary(),
    listCourses(),
    loadSettings(),
  ]);

  return (
    <>
      <div className="page-head">
        <h1>قاموس النطق</h1>
        <span className="muted">{entries.length} مصطلح</span>
      </div>

      <p className="muted" style={{ marginBlockStart: 0 }}>
        يُطبَّق القاموس على نص السرد قبل إرساله إلى ElevenLabs. الاستبدال بالكلمات الكاملة فقط.
        التشكيل يُكتب هنا فقط — لا يُشكَّل السرد تلقائياً.
      </p>

      <DictionaryTable
        entries={entries.map((e) => ({
          id: e.id,
          term: e.term,
          replacement: e.replacement,
          note: e.note,
          scope: e.scope,
          courseId: e.courseId,
        }))}
        courses={courses}
        usdPer1kChars={TTS_USD_PER_1K_CHARS[settings.ttsModel]}
      />
    </>
  );
}
