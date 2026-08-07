# Web service — kept deliberately small (§2). The 2 GB Playwright/LibreOffice
# image lives in the worker only, so web deploys stay fast.
# Build context is the repo root.

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ── deps ──────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Every workspace member's manifest, including the worker's: pnpm-workspace.yaml
# declares apps/*, and --frozen-lockfile rejects the install if a declared
# member is missing from the tree.
COPY packages/core/package.json ./packages/core/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
RUN pnpm install --frozen-lockfile --filter @course-prod/web... --prod=false

# ── build ─────────────────────────────────────────────────────────────────
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# `web...` builds @course-prod/core first — Next consumes its compiled dist,
# not its TypeScript source.
RUN pnpm --filter @course-prod/web... build

# ── runtime ───────────────────────────────────────────────────────────────
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Next's standalone server binds to `process.env.HOSTNAME || '0.0.0.0'`, and
# Docker sets HOSTNAME to the container id — so without this it tries to bind
# to something like "a1b2c3d4" and nothing outside the container can reach it.
# That is what failed Railway's healthcheck three deploys running while the
# container itself looked perfectly healthy.
#
# "::" rather than 0.0.0.0 so the socket is dual-stack and accepts IPv6 too;
# Railway's internal networking uses it, and the worker only ever passed its
# healthcheck because server.listen(port) with no host already does this.
ENV HOSTNAME="::"

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# Next's standalone output already contains the pruned node_modules it needs.
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
