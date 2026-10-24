# syntax=docker/dockerfile:1.7
# The api image. One image, four commands (typescript §13): api, worker, migrate and the `toa` CLI.
# Build context: the repo root.   docker build -f docker/api/Dockerfile .

# Pinned by tag and digest (DOCKER_STANDARD rule 1). Dependabot opens a PR when a new one is out.
ARG NODE_IMAGE=node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f

# The packages this image runs, with everything they depend on inside the workspace.
# `...` means "and the workspace packages it depends on".
ARG PNPM_FILTER='--filter @toascribe/api... --filter @toascribe/worker... --filter @toascribe/cli...'

# ── Stage 1: fetch ─────────────────────────────────────────
# `pnpm fetch` needs only the lockfile, so this layer is reused until the lockfile changes.
FROM ${NODE_IMAGE} AS fetch
WORKDIR /app
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

# ── Stage 2: build ─────────────────────────────────────────
FROM fetch AS build
ARG PNPM_FILTER
COPY . .
RUN pnpm install --offline --frozen-lockfile ${PNPM_FILTER} \
 && pnpm ${PNPM_FILTER} run build

# ── Stage 3: production dependencies ───────────────────────
# Same workspace layout as the build, but only production dependencies (no TypeScript, no Vitest).
# `pnpm fetch` filled node_modules/.pnpm with every package in the lockfile; remove it so only what
# the filtered install links is left. The download itself stays in the pnpm store, outside /app.
FROM fetch AS prod-deps
ARG PNPM_FILTER
COPY . .
RUN rm -rf node_modules \
 && pnpm install --offline --frozen-lockfile --prod ${PNPM_FILTER}

# ── Stage 4: runtime ───────────────────────────────────────
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

# Non-root user. npm, npx, corepack and yarn are not needed to run node dist/*.js and carry their own CVEs.
# apk upgrade: every build takes all security fixes Alpine has published since the base image was built, not only
# the one a scan found that day. The image scan before publishing is still the gate.
RUN apk upgrade --no-cache \
 && addgroup -S -g 10001 app \
 && adduser -S -u 10001 -G app -h /app -s /sbin/nologin app \
 && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg

ENV NODE_ENV=production \
    PORT=3001

# Production node_modules, laid out as in the workspace (pnpm symlinks packages/*/node_modules into the root store).
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod-deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=prod-deps /app/cli/node_modules ./cli/node_modules
COPY --from=prod-deps /app/packages/auth/node_modules ./packages/auth/node_modules
COPY --from=prod-deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=prod-deps /app/packages/install/node_modules ./packages/install/node_modules
COPY --from=prod-deps /app/packages/shared/node_modules ./packages/shared/node_modules

# Compiled code and package.json (the version is read from apps/api and cli at run time).
COPY --from=build /app/apps/api/package.json /app/apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/worker/package.json /app/apps/worker/package.json
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/packages/auth/package.json ./packages/auth/package.json
COPY --from=build /app/packages/auth/dist ./packages/auth/dist
COPY --from=build /app/packages/db/package.json ./packages/db/package.json
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/migrations ./packages/db/migrations
COPY --from=build /app/packages/install/package.json ./packages/install/package.json
COPY --from=build /app/packages/install/dist ./packages/install/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/cli/package.json ./cli/package.json
COPY --from=build /app/cli/dist ./cli/dist

# `toa` on PATH. The file is already executable after `pnpm build`.
RUN ln -s /app/cli/dist/index.js /usr/local/bin/toa

USER 10001:10001
EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "apps/api/dist/healthcheck.js"]

# Exec form so node gets SIGTERM (DOCKER_STANDARD, «Drift i produksjon»).
# The worker and the migrate step use the same image with another command (see docker/compose.yaml).
CMD ["node", "apps/api/dist/index.js"]
