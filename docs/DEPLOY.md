# Deploy — Railway

Three services in one Railway project: `postgres`, `web`, `worker`. One volume,
mounted on `worker` only.

Milestone 1 gate: **you can log in on the Railway URL.**

---

## 0. Prerequisites

- Node 20.11+ and pnpm 9 locally (`corepack enable && corepack prepare pnpm@9.12.0 --activate`)
- A Railway account with the repo connected
- Two secrets generated locally:

```bash
openssl rand -base64 32   # SESSION_SECRET
```

Run it twice — `SESSION_SECRET` and `SERVICE_KEY` must be different values.

---

## 1. Postgres

Railway dashboard → **New** → **Database** → **PostgreSQL**.

Railway exposes `DATABASE_URL` on the database service. Reference it from the
other two services rather than pasting the value, so a credential rotation does
not need three edits:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

`pg-boss` creates its own schema on first boot (§2) — no separate queue service.

---

## 2. Volume

Railway dashboard → `worker` service → **Settings** → **Volumes** → **New Volume**.

- Mount path: `/data`
- Size: start at 10 GB

One lesson's PNGs + MP3s + MP4 run to a few hundred MB, so 10 GB is roughly 30
lessons of retained output. The worker's `/health` reports `percent_used` and
goes `degraded` above 90%.

**Attach the volume to `worker` only.** The web service reads files through the
signed-URL route, never from disk.

---

## 3. `web` service

**New** → **GitHub Repo** → this repo.

Settings:

| Setting | Value |
|---|---|
| Root directory | `/` (repo root — the Dockerfile needs the workspace) |
| Dockerfile path | `apps/web/Dockerfile` |
| Health check path | `/api/health` |
| Health check timeout | 30s |

Variables:

```
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
SESSION_SECRET=<from step 0>
SERVICE_KEY=<from step 0>
PUBLIC_URL=https://<your-web-domain>.up.railway.app
STATE_DIR=/data
MONTHLY_BUDGET_USD=300
```

`PUBLIC_URL` must match the real domain — signed download URLs are built from
it, and a wrong value produces links that 404 for everyone but you.

Generate the domain under **Settings → Networking → Generate Domain**, then set
`PUBLIC_URL` to it and redeploy.

---

## 4. `worker` service

**New** → **GitHub Repo** → same repo.

| Setting | Value |
|---|---|
| Root directory | `/` |
| Dockerfile path | `apps/worker/Dockerfile` |
| Health check path | `/health` |
| Health check timeout | 60s (the image is ~2 GB and boots slower) |
| Networking | **do not** generate a public domain |

Variables:

```
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
SERVICE_KEY=<same value as web>
PUBLIC_URL=https://<your-web-domain>.up.railway.app
STATE_DIR=/data
MONTHLY_BUDGET_USD=300
PORT=3001

# added as the milestones land
ANTHROPIC_API_KEY=          # M2
DOKIE_API_KEY=              # M3
DOKIE_EMAIL=                # M4
DOKIE_PASSWORD=             # M4
ELEVENLABS_API_KEY=         # M5
ELEVENLABS_VOICE_ID=        # M5
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

§10 requires the worker not be publicly routed. Its only unauthenticated route
is `/health`; everything else demands the `X-Service-Key` header.

---

## 5. Migrations

Run once after the first successful deploy, and after any schema change.

Locally, against the Railway database:

```bash
export DATABASE_URL='<Postgres public connection string from Railway>'
pnpm install
pnpm db:generate
pnpm db:migrate
```

`db:generate` writes SQL into `packages/core/drizzle/`. **Commit that folder** —
migrations are reviewed artefacts, not build output.

---

## 6. One-time `/login` bootstrap

There is no public signup (§10), so the first admin is created by script:

```bash
export DATABASE_URL='<Railway Postgres connection string>'
ADMIN_EMAIL='you@engosoft.com' ADMIN_PASSWORD='<16+ chars>' ADMIN_NAME='Eyad' pnpm bootstrap:admin
```

This also seeds the pronunciation dictionary with the four §6.6 entries
(`انجوسوفت → Engosoft`, `PMP`, `PMBOK`, `Agile`).

Re-running updates the password of an existing admin, so it doubles as a
password reset.

Then open `https://<your-web-domain>.up.railway.app/login`. **That is the M1
acceptance gate.**

---

## 7. Verify

```bash
curl -s https://<your-web-domain>.up.railway.app/api/health | jq
```

Expected:

```json
{
  "service": "web",
  "status": "ok",
  "checks": {
    "database": { "ok": true, "latency_ms": 12 },
    "config": { "sessionSecret": true, "serviceKey": true, "publicUrl": true }
  }
}
```

The worker has no public domain, so check its health from the Railway service
shell:

```bash
curl -s http://localhost:3001/health | jq
```

`dokie_session.state` reads `"missing"` until M4 — that is correct for M1, not a
failure.

---

## 8. Local development

```bash
pnpm install
cp .env.example .env    # fill SESSION_SECRET, SERVICE_KEY, DATABASE_URL
pnpm db:generate && pnpm db:migrate
ADMIN_EMAIL=you@engosoft.com ADMIN_PASSWORD='changeme-please-1' pnpm bootstrap:admin
pnpm dev
```

Postgres locally, if you have Docker:

```bash
docker run -d --name course-prod-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=course_prod -p 5432:5432 postgres:16
```

Without Docker, use a Railway Postgres instance and point `DATABASE_URL` at its
public connection string.

---

## Operational notes

**Graceful shutdown.** The worker drains in-flight jobs on `SIGTERM` with a 25s
hard cap, inside Railway's ~30s window. Redeploying mid-export is safe; killing
the container is not.

**Rollbacks.** Roll `web` back freely. Rolling `worker` back across a migration
is only safe if the migration was additive — the queue tables are shared and an
old worker will not understand a renamed column.

**Never commit** `.env`, `/data`, or `dokie-state.json`. All three are in
`.gitignore`; §10 forbids logging a token, a cookie, or `storageState`, and the
logger redacts by key name as a backstop.
