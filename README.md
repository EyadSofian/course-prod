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
| 1 | Repo, Docker, Railway, auth, DB, `/health` | builds, tests pass, **not yet deployed** |
| 2 | Ingest + Summarize + review editor | not started |
| 3 | Dokie MCP integration | not started |
| 4 | Export + PDF/PNG | not started |
| 5 | Narration + dictionary | not started |
| 6 | Assemble + publish + costs | not started |

### What M1 has actually been verified to do

- `pnpm typecheck`, `pnpm build` and `pnpm test` pass (8 tests covering the §4
  invariant, §10 redaction and session/URL signing, §6.2 fence stripping, and
  §6.3 slide reordering).
- The **standalone** web build boots and serves: `/login` renders RTL Arabic,
  an unauthenticated `/` 307s to `/login?next=/`, a forged signed URL is
  rejected 403, and `/api/health` returns 503 `degraded` with the real
  connection error when Postgres is absent.
- The worker creates its `/data` subdirectories, fails fast with a structured
  JSON error when Postgres is unreachable, and exits non-zero.

### What is still unverified

- **Neither Docker image has been built** — no Docker on the machine this was
  written on.
- **Nothing has run against a real Postgres.** Migrations are generated
  (`packages/core/drizzle/0000_*.sql`, 8 tables) but have never been applied,
  so `bootstrap:admin` and an end-to-end login are untested.
- The M1 acceptance gate — *log in on the Railway URL* — has not been met.

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
