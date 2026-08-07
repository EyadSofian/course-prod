# داشبورد إنتاج الكورسات — Course Production Dashboard

Internal Engosoft tool. Takes raw course material (PDF / DOCX / PPTX / text) and
produces a finished, downloadable Arabic lesson package: structured lesson JSON,
quiz bank, slide deck, per-slide narration, assembled MP4 + SRT.

Everything is served from our own storage. No third-party links go to a client
or a trainee.

## Layout

```
apps/web        Next.js 15 (App Router, TS) — UI + REST API. Small image.
apps/worker     Node worker — Playwright + LibreOffice + ffmpeg + poppler. ~2 GB image.
packages/core   Shared: zod schema, drizzle db, job definitions, providers.
docs/           DEPLOY.md, ux-copy.ar.md
```

Queue is `pg-boss` on the same Postgres — no Redis. Storage sits behind an
`ObjectStore` interface so S3/R2 is a config swap.

## Status

| M | Deliverable | State |
|---|---|---|
| 1 | Repo, Docker, Railway, auth, DB, `/health` | builds, tests pass, deploying |
| 2 | Ingest + Summarize + review editor | code complete, **never run against a real API** |
| 3 | Dokie MCP integration | code complete, **never run against Dokie** |
| 4 | Export + PDF/PNG | code complete, **Phase 0 not done** |
| 5 | Narration + dictionary | code complete, **never run against ElevenLabs** |
| 6 | Assemble + publish + costs | code complete, **ffmpeg path never executed** |

### Verified

- `pnpm typecheck`, `pnpm build`, `pnpm test` pass from a clean tree and a
  fresh clone (26 tests).
- Pure logic is covered: the §4 invariant, §10 redaction and signing, §6.2
  fence stripping, §6.3 reordering, §6.6 Arabic whole-word replacement and TTS
  chunking, §6.7 SRT generation including the text_raw/text_tts rule.
- The standalone web build boots and serves login, the auth redirect, health,
  and signed-URL rejection.

### Not verified — needs credentials or a deployed environment

Nothing below has ever executed. It is written against the documented
behaviour of each service, not against the services themselves.

- **Summarize** has never called OpenAI. Needs `OPENAI_API_KEY`. This is the
  M2 risk §12 names: the summarizer must be consistent across five different
  source documents before the rest is worth trusting.
- **Dokie** has never been contacted. The MCP response shapes are parsed
  defensively and the raw text is kept in `stage_runs.log`, because they are
  guesses until someone runs it.
- **Export Phase 0 has not been done.** `DOKIE_EXPORT_ENDPOINT` is null, so
  `BrowserExporter` is the only path and its selectors are guesses. See
  §6.5 — the endpoint capture turns this into a plain HTTP call.
- **ElevenLabs** has never been called.
- **ffmpeg / LibreOffice / poppler** have never run: none are installed on the
  machine this was written on. They exist only in the worker image.
- **Neither Docker image has been built.**

## Quick start

```bash
pnpm install
cp .env.example .env          # fill SESSION_SECRET, SERVICE_KEY, DATABASE_URL
pnpm db:generate && pnpm db:migrate
ADMIN_EMAIL=you@engosoft.com ADMIN_PASSWORD='changeme-please-1' pnpm bootstrap:admin
pnpm dev
```

## Conventions

- **Arabic-first, RTL throughout.** Logical CSS properties only — no `margin-left`.
  Every user-facing string lives in `apps/web/lib/strings.ts` and mirrors
  `docs/ux-copy.ar.md`. That file is the terminology source of truth.
- **`إعادة المحاولة` (retry, free) and `إعادة التوليد` (regenerate, costs money)
  are never interchangeable** and never appear on the same stage.
- **The §4 invariant is enforced in the schema, not at assembly time**: every
  `narration[].slide_id` exists in `slides[]` and the counts match. See
  `packages/core/src/schema/lesson.ts`.
- **`text_raw` and `text_tts` are never collapsed.** Subtitles come from
  `text_raw`; only `text_tts` carries dictionary substitutions and tashkeel.
- **No model ids, voice ids, prompts or selectors in business logic** — they
  live in `packages/core/src/settings.ts` or the database.

## Not this

No n8n. No Redis. No LMS rebuild. No multi-tenant. Claude in Chrome is a
discovery instrument for the Dokie export (§6.5 Phase 0), never a runtime
dependency.
