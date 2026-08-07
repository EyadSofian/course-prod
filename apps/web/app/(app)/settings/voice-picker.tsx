"use client";

import { useRef, useState } from "react";
import type { Voice } from "@/lib/worker";

/**
 * Voice selection by name, with an audible sample (§6.6).
 *
 * The previous version was a bare text field for a raw ElevenLabs id. Nobody
 * can tell what "21m00Tcm4TlvDq8ikWAM" sounds like, and a wrong guess is only
 * discovered after an entire lesson has been narrated and billed. Hearing the
 * voice before committing is the whole point.
 */
export function VoicePicker({
  voices,
  current,
  error,
}: {
  voices: Voice[];
  current: string;
  error?: string;
}) {
  const [selected, setSelected] = useState(current);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const play = (voice: Voice) => {
    if (!voice.previewUrl) return;
    audioRef.current?.pause();

    if (playing === voice.id) {
      setPlaying(null);
      return;
    }
    const audio = new Audio(voice.previewUrl);
    audioRef.current = audio;
    audio.onended = () => setPlaying(null);
    void audio.play().catch(() => setPlaying(null));
    setPlaying(voice.id);
  };

  if (error || voices.length === 0) {
    return (
      <div className="field">
        <label htmlFor="voiceId">الصوت</label>
        <input id="voiceId" name="voiceId" defaultValue={current} dir="ltr" placeholder="voice id" />
        <span className="muted">
          {error ?? "تعذّر جلب قائمة الأصوات."} أدخل المعرّف يدوياً مؤقتاً.
        </span>
      </div>
    );
  }

  return (
    <div className="field">
      <label>الصوت</label>
      <input type="hidden" name="voiceId" value={selected} />

      <div className="voice-list" role="radiogroup" aria-label="اختيار الصوت">
        {voices.map((voice) => (
          <div
            key={voice.id}
            className="voice-row"
            data-selected={selected === voice.id}
            onClick={() => setSelected(voice.id)}
            role="radio"
            aria-checked={selected === voice.id}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSelected(voice.id);
              }
            }}
          >
            <span className="voice-dot" aria-hidden />

            <span className="voice-meta">
              <span className="voice-name">
                {voice.name}
                {!voice.supportsArabic ? (
                  <span className="voice-warn" title="هذا الصوت غير موثّق للعربية">
                    غير موثّق للعربية
                  </span>
                ) : null}
              </span>
              {voice.description ? (
                <span className="voice-desc">{voice.description}</span>
              ) : null}
            </span>

            {voice.previewUrl ? (
              <button
                type="button"
                className="btn btn-ghost voice-play"
                onClick={(e) => {
                  e.stopPropagation();
                  play(voice);
                }}
                aria-label={`استماع لصوت ${voice.name}`}
              >
                {playing === voice.id ? "■ إيقاف" : "▶ استماع"}
              </button>
            ) : (
              <span className="muted" style={{ fontSize: 11 }}>
                لا توجد عيّنة
              </span>
            )}
          </div>
        ))}
      </div>

      <span className="muted">
        يُطبَّق على الدروس الجديدة. الدروس المولَّدة لا تتغيّر.
      </span>
    </div>
  );
}
