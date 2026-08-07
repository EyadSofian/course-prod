# Worker service — the fat image (~2 GB) per §11.
# Playwright base + LibreOffice (PPTX→PDF) + poppler (PDF→PNG) + ffmpeg
# (slide+audio→MP4) + Arabic fonts, without which LibreOffice renders every
# Arabic slide as tofu boxes.
# Build context is the repo root.

FROM mcr.microsoft.com/playwright:v1.49.0-jammy AS base

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-impress \
      poppler-utils \
      ffmpeg \
      fonts-noto \
      fonts-noto-core \
      fonts-kacst \
      fonts-noto-color-emoji \
 && fc-cache -f \
 && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ── deps ──────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY apps/worker/package.json ./apps/worker/
RUN pnpm install --frozen-lockfile --filter @course-prod/worker... --prod=false

# ── build ─────────────────────────────────────────────────────────────────
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY . .
RUN pnpm --filter @course-prod/worker build

# ── runtime ───────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3001
ENV STATE_DIR=/data

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build /app/apps/worker/package.json ./apps/worker/

# Railway mounts the volume here (§11). Created so a first boot before the
# mount attaches does not crash on a missing path.
RUN mkdir -p /data/objects /data/shots

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# SIGTERM must reach Node directly for graceful shutdown (§9) — no shell wrapper.
CMD ["node", "apps/worker/dist/index.js"]
