# syntax=docker/dockerfile:1.7
# One Dockerfile, two images: the site and the admin app are separate Nuxt builds, so each image holds only
# its own .output folder (about 6 MB). Pick the app with APP.
# Build context: the repo root.
#   docker build -f docker/nuxt/Dockerfile --build-arg APP=site  .
#   docker build -f docker/nuxt/Dockerfile --build-arg APP=admin --build-arg HEALTH_PATH=/admin .

# Pinned by tag and digest (DOCKER_STANDARD rule 1). Dependabot opens a PR when a new one is out.
ARG NODE_IMAGE=node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f

# ── Stage 1: fetch ─────────────────────────────────────────
FROM ${NODE_IMAGE} AS fetch
WORKDIR /app
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

# ── Stage 2: build ─────────────────────────────────────────
# Nothing from the environment goes into this build: deploy-specific values reach the app at run time
# through NUXT_* variables (APP_CONFIG_STANDARD, «Build-vs-runtime»), so one image fits every installation.
FROM fetch AS build
ARG APP
RUN test -n "${APP}" || { echo "build argument APP is required (site or admin)" >&2; exit 1; }
COPY . .
RUN pnpm install --offline --frozen-lockfile --filter "@toascribe/${APP}..." \
 && pnpm --filter "@toascribe/${APP}" run build

# ── Stage 3: runtime ───────────────────────────────────────
# .output is self-contained (Nitro bundles what it needs), so the runtime stage has no node_modules.
FROM ${NODE_IMAGE} AS runner
ARG APP
ARG HEALTH_PATH=/
WORKDIR /app

# Non-root user. npm, npx, corepack and yarn are not needed to run node .output/server/index.mjs.
RUN addgroup -S -g 10001 app \
 && adduser -S -u 10001 -G app -h /app -s /sbin/nologin app \
 && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg

ENV NODE_ENV=production \
    PORT=3000 \
    HEALTH_PATH=${HEALTH_PATH}

COPY --from=build /app/apps/${APP}/.output ./.output

USER 10001:10001
EXPOSE 3000

# Nitro listens on IPv4, so the check uses 127.0.0.1, not localhost. Any non-5xx answer means the server is up:
# the page itself renders (with an error badge) while the API is down, and that must not mark the web app unhealthy.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+process.env.HEALTH_PATH,{signal:AbortSignal.timeout(4000),redirect:'manual'}).then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"]

CMD ["node", ".output/server/index.mjs"]
