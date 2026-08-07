import { createLogger } from "../logger.js";
import { RetryableError, TerminalError } from "../stages.js";

const log = createLogger("tts.voices");

/**
 * Lists the account's ElevenLabs voices so a producer can pick one by name and
 * hear it, instead of pasting an opaque id.
 *
 * Arabic-capable voices are surfaced first: every lesson this system produces
 * is Arabic, so a voice that cannot speak it is never the right answer, and
 * burying that fact behind a raw id is how you end up generating an entire
 * lesson in the wrong voice before anyone notices.
 */

export interface Voice {
  id: string;
  name: string;
  /** Short human label: "أنثى · شابة · سرد" */
  description: string;
  /** Sample MP3 the UI can play inline. */
  previewUrl: string | null;
  category: string;
  languages: string[];
  supportsArabic: boolean;
}

const LABEL_AR: Record<string, string> = {
  female: "أنثى",
  male: "ذكر",
  neutral: "محايد",
  young: "شاب",
  "middle aged": "متوسط العمر",
  "middle_aged": "متوسط العمر",
  old: "كبير",
  narration: "سرد",
  news: "أخبار",
  conversational: "حواري",
  characters: "شخصيات",
  "social media": "سوشيال ميديا",
};

const translate = (value: string): string =>
  LABEL_AR[value.toLowerCase()] ?? value;

export async function listVoices(): Promise<Voice[]> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new TerminalError(
      "مفتاح ElevenLabs غير مضبوط. أضف ELEVENLABS_API_KEY إلى متغيّرات خدمة worker.",
      "AUTH_FAILURE",
    );
  }

  let res: Response;
  try {
    res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new RetryableError(`تعذّر الوصول إلى ElevenLabs: ${(e as Error).message}`);
  }

  if (res.status === 401 || res.status === 403) {
    throw new TerminalError("مفتاح ElevenLabs مرفوض.", "AUTH_FAILURE");
  }
  if (!res.ok) {
    throw new RetryableError(`تعذّر جلب قائمة الأصوات (${res.status}).`);
  }

  const body = (await res.json()) as { voices?: RawVoice[] };
  const voices = (body.voices ?? []).map(toVoice);

  log.info("voices listed", {
    total: voices.length,
    arabic: voices.filter((v) => v.supportsArabic).length,
  });

  // Arabic-capable first, then alphabetical within each group.
  return voices.sort((a, b) => {
    if (a.supportsArabic !== b.supportsArabic) return a.supportsArabic ? -1 : 1;
    return a.name.localeCompare(b.name, "ar");
  });
}

interface RawVoice {
  voice_id?: string;
  name?: string;
  preview_url?: string;
  category?: string;
  labels?: Record<string, string>;
  verified_languages?: { language?: string }[];
  fine_tuning?: { language?: string | null };
}

function toVoice(raw: RawVoice): Voice {
  const labels = raw.labels ?? {};
  const languages = [
    ...new Set(
      [
        ...(raw.verified_languages ?? []).map((l) => l.language ?? ""),
        raw.fine_tuning?.language ?? "",
        labels.language ?? "",
      ].filter(Boolean),
    ),
  ];

  // Multilingual voices carry no per-language list but do speak Arabic, so an
  // empty list is treated as capable rather than hidden.
  const supportsArabic =
    languages.length === 0 || languages.some((l) => /^ar/i.test(l));

  const descriptors = [labels.gender, labels.age, labels.use_case ?? labels.description]
    .filter(Boolean)
    .map((v) => translate(String(v)));

  return {
    id: raw.voice_id ?? "",
    name: raw.name ?? "بدون اسم",
    description: descriptors.join(" · ") || translate(raw.category ?? ""),
    previewUrl: raw.preview_url ?? null,
    category: raw.category ?? "",
    languages,
    supportsArabic,
  };
}
