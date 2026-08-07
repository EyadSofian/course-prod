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

## Status — Milestone 1

| M | Deliverable | State |
|---|---|---|
| 1 | Repo, Docker, Railway, auth, DB, `/health` | code complete, **unverified** |
| 2 | Ingest + Summarize + review editor | not started |
| 3 | Dokie MCP integration | not started |
| 4 | Export + PDF/PNG | not started |
| 5 | Narration + dictionary | not started |
| 6 | Assemble + publish + costs | not started |

**M1 has never been compiled or run.** It was written on a machine without
Node, pnpm, Docker or Postgres. Expect to fix import paths and dependency
versions on the first `pnpm install && pnpm build`. See `docs/DEPLOY.md` §8.

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
