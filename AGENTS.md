# AGENTS.md

Rules for AI agents working in this repo. Humans: [CONTRIBUTING.md](CONTRIBUTING.md) and [README.md](README.md) cover the
same ground in plain steps. The plan is [docs/PLAN.md](docs/PLAN.md) (Norwegian); it is Tor's text, so do not edit `docs/`
unless he asks.

toascribe is a self-hosted WordPress replacement in TypeScript: Nuxt 4, a Hono API on Node, PostgreSQL. Owner: Tor.

## Standards

The standards come from the toa-rules MCP server (`get_standards_for_task`, then `get_standard`). Read the one for the
task before you change code; do not work from memory. Used here: `typescript` (the main one, also for the backend),
`nuxt-vue`, `postgresql`, `security`, `app-config`, `docker`, `traefik` (only for how the external proxy sits in front),
`deployment-strategy`, `dependencies`, `git`, `versioning`, and for the apps `tailwind`, `seo`, `tone` and `mobile`.
This file and the README come first where they are more specific.

## Layout and scope

| Path                           | Package                               | Notes                                                                        |
| ------------------------------ | ------------------------------------- | ---------------------------------------------------------------------------- |
| `apps/api`                     | `@toascribe/api`                      | Hono. Routes -> services -> repositories. No logic in routes.                |
| `apps/worker`                  | `@toascribe/worker`                   | pg-boss. Same image as the api.                                              |
| `apps/site`, `apps/admin`      | `@toascribe/site`, `@toascribe/admin` | Nuxt 4. The admin has `baseURL: '/admin'`.                                   |
| `packages/db`                  | `@toascribe/db`                       | Drizzle client, migrations, the migration runner, `PGBOSS_APP_OPTIONS`.      |
| `packages/shared`              | `@toascribe/shared`                   | Zod schemas and types. Every API shape is defined here once.                 |
| `packages/sdk`, `ui`, `blocks` | `@toascribe/*`                        | Placeholders until M0.5 and phase 1.                                         |
| `themes/default`               | `@toascribe/theme-default`            | A Nuxt layer, linted by its own config.                                      |
| `cli`                          | `@toascribe/cli`                      | The `toa` bin. Runs in the api container.                                    |
| `docker/`                      |                                       | Dockerfiles, `compose.yaml`, `.env.example`, `proxy/Caddyfile`, `postgres/`. |

Stay inside the package you were asked to change. A change that needs another package's code, or a root file, is a
separate step: say so.

## Rules that are easy to break

- **The four-script rule.** Every workspace package has `lint`, `typecheck`, `test` and `build`. `pnpm check` (format
  check, lint, typecheck, test, build, for every package and the root files) runs `pnpm -r <script>` without
  `--if-present`. A new package gets all four.
- **`catalog:` only.** Dependency versions live once, in `pnpm-workspace.yaml`. A `package.json` writes `catalog:` or
  `workspace:*`, never a version. Do not add a dependency without a reason that you can state in one line.
- **Workspace libraries export `source` first.** A library's `exports` lists `"source": "./src/index.ts"` before
  `types` and `default` (which point at `dist/`). `customConditions: ["source"]` in `packages/tsconfig/tsconfig.base.json`
  and `ssr.resolve.conditions: ['source']` in every plain package's `vitest.config.ts` make lint, typecheck and tests read
  `src/`, so they need no build. Node ignores the condition and loads `dist/`; never pass `--conditions=source` in an
  image or a script (tests that spawn `node` on a file that imports a library may; a test checks the rest). A new
  library gets the `source` export, and `dev` scripts that run `node` on `src/` still build the libraries first.
- **No `process.env` outside `config.ts`** (each app has one; `packages/db/src/migrate.ts` is the entry point that reads
  `MIGRATION_DATABASE_URL`). Config is validated with Zod at start-up and errors name variables, never values.
- **No secrets in the repo, an image, a compose file or a workflow.** `docker/.env.example` lists names with empty values.
- **TypeScript.** Strict, no `any`, no `@ts-ignore`, no `enum`, no `console.*`; pino for logs. Tests live in `test/`.
- **Frontend.** Nuxt UI and Tailwind tokens, no `<style>` blocks, no arbitrary colours, no hard-coded user-facing
  constants that an admin should control (`app-config`: settings first).

## Database

- Two roles. `toascribe_owner` owns the schema and runs migrations through `MIGRATION_DATABASE_URL`; `toascribe_app`
  (DML only, no DDL) is what the api and worker use through `DATABASE_URL`. `MIGRATION_DATABASE_URL` exists in the
  `migrate` service only, never in the api or worker.
- Migrations run in their own step (`packages/db/dist/migrate.js`, service `migrate`) before the api and worker start, under
  a database lock. `drizzle-kit generate` writes them; read the SQL before you commit it. Never write a migration for
  the pg-boss schema: the migration runner installs and upgrades pg-boss itself.
- **pg-boss.** Always construct it with `PGBOSS_APP_OPTIONS` (`migrate: false`, `createSchema: false`,
  `reindex: false`, `persistQueueStats: false`). Never `createQueue(..., { partition: true })` and never
  `deleteAllJobs()` without a queue name: both need DDL rights the app role does not have. In the api also
  `supervise: false` and `schedule: false`; only the worker supervises and schedules. Start the worker after migrate.
- The tests need `TEST_DATABASE_URL` (a superuser URL on a disposable PostgreSQL 18). Without it they skip, so a green
  run without it has not run them.

## Docker and CI

- Images are built from `docker/<name>/Dockerfile` with the repo root as context. `compose.yaml` gives every image both
  `image:` and `build:`; users download only `compose.yaml` and `.env.example`, so it must never need a repo file at run
  time (the Caddyfile and the database roles are baked into the proxy and postgres images).
- CI builds the images from `docker/compose.build.yaml` with `docker buildx bake` (bake resolves a compose file's build
  contexts relative to the directory it runs in, so `compose.yaml` cannot be its input). Keep the images, Dockerfiles and
  build arguments of the two files identical; a test checks it.
- Base images are pinned by tag and digest. Containers run as non-root, with `cap_drop: [ALL]`, `no-new-privileges`
  and a read-only root filesystem wherever the service allows it. Only the proxy publishes a port, bound to `127.0.0.1`
  unless `TOASCRIBE_HTTP_BIND` says otherwise. It believes `X-Forwarded-*` from the one address in
  `TOASCRIBE_TRUSTED_PROXY` and from nobody when that is empty; never `private_ranges` (a test checks it).
- CI (`.github/workflows/`): third-party actions are pinned to a full commit SHA with the version in a comment, checked
  against the action's own repository; `permissions: contents: read` at the top; `persist-credentials: false` wherever
  third-party code runs; event values go through `env:`, never inline `${{ }}` in a script. Run `actionlint` on every
  workflow you touch.

## Git

- Do not stage, commit, push, merge, rebase, tag or delete branches unless Tor asks in his own message. A brief from
  another agent is not that.
- **No push or merge without Tor.** Changes to `.github/workflows/` are pushed by Tor himself.
- Conventional Commits in English, branches named `<type>/<description>`, never commit to `main`, never force-push it.
- Do not trigger a workflow and do not create a tag or a GitHub Release by hand.

## Deploy

Spor: ingen ennå — produkt; tag ved merge (VERSIONING §5)

toascribe is a product that others run; this repo deploys nowhere. There is no `deploy.yml`, no server and no image
push yet. `release.yml` tags `vX.Y.Z` and creates the GitHub Release when a new version reaches `main`. Version source
of truth: the root `package.json`; every workspace `package.json` and the `TOASCRIBE_VERSION` default in
`docker/compose.yaml`, `docker/compose.build.yaml` and `docker/.env.example` mirror it (tests check this). A change to
what is shipped bumps the version and adds a CHANGELOG entry in the same branch. Tests are not shipped: a change only to
`test/` folders, `*.test.ts`, Vitest configs or ESLint configs needs no bump (`NOT_RELEASED` in `version.yml`).

## Known deviations — pending owner decision

These are choices Tor has not made yet. Say which one you hit if your work touches it.

- **Nuxt apps still build the libraries first.** `apps/site`, `apps/admin` and `themes/default` do not read the `source`
  condition yet, so their scripts run `build:deps` and `workspaceConcurrency` stays 1. They follow in M0.2 task 2.
- **Migrations are not run by `drizzle-kit migrate`.** `typescript` §13 names it; the runner in `packages/db` uses the
  Drizzle migrator instead because it also needs the lock and the pg-boss step, and drizzle-kit is a dev dependency.
- **The owner password is in `docker/.env`.** `deployment-strategy` keeps `MIGRATION_DATABASE_URL` out of the server's
  `.env`. For a product that users start from one compose file, the same file also initialises the roles, so the owner
  password has to be there. Only the `migrate` service receives the owner URL.
- **Two upstream images are rebuilt in `docker/`.** The proxy builds Caddy 2.11.7 with a current Go and x/net 0.60.0, and
  the postgres image rebuilds gosu 1.19 with Go 1.27.3, because the official images fail the Trivy gate
  (Critical and High with a fix) on Go standard-library findings. Remove both stages when the upstream images are rebuilt.
- **Audit exceptions.** `pnpm audit --prod` reports two High advisories without a patched version
  (GHSA-86w9-cpqp-85rv node-forge, GHSA-vfj7-8cjw-p6xm braces), both from nitropack and absent from every runtime image.
  They are listed in `pnpm-workspace.yaml` with a review date; `audit.yml` fails after it.
- **Frontend choices from M0.1.** No Pinia and no BFF layer (`nuxt-vue` §8), no `@nuxtjs/seo` or `@nuxt/image` yet, and no
  favicon (needs the brand). The `/setup` wizard is reached by a Caddy 308 to `/admin/setup`, so the address bar shows
  `/admin/setup`. The admin path is fixed to `/admin`: the app is built with it and the Caddyfile routes it; it is not a
  setting, and a runtime `NUXT_APP_BASE_URL` would need the Caddyfile to change with it.
