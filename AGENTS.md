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
| `packages/install`             | `@toascribe/install`                  | Install service (setup token, steps, install). The api and the cli call it.  |
| `packages/auth`                | `@toascribe/auth`                     | Password hashing (argon2id, WordPress hash import) and one-time tokens.      |
| `packages/http`                | `@toascribe/http`                     | `safeFetch`: an HTTP client that refuses private addresses (SSRF).           |
| `packages/nuxt-base`           | `@toascribe/nuxt-base`                | The Nuxt layer both apps share: Nuxt UI, i18n, API layer and plugin, config. |
| `packages/sdk`, `ui`, `blocks` | `@toascribe/*`                        | Placeholders until phase 1.                                                  |
| `themes/default`               | `@toascribe/theme-default`            | A Nuxt layer that extends `nuxt-base`, linted by its own config.             |
| `cli`                          | `@toascribe/cli`                      | The `toa` bin. Runs in the api container.                                    |
| `docker/`                      |                                       | Dockerfiles, `compose.yaml`, `.env.example`, `proxy/Caddyfile`, `postgres/`. |
| `scripts/`                     |                                       | Release and gate scripts: `release-check.sh`, tag check, notes, image copy.  |

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
  and `ssr.resolve.conditions: ['source']` in every package's `vitest.config.ts` make lint, typecheck and tests read
  `src/`, so they need no build. Node ignores the condition and loads `dist/`; never pass `--conditions=source` in an
  image or a script (tests that spawn `node` on a file that imports a library may; a test checks the rest). A new
  library gets the `source` export, and `dev` scripts that run `node` on `src/` still build the libraries first.
  The Nuxt packages do not use the condition (Nuxt UI's own dependencies export a `source` condition too, and
  TypeScript or Vite would then take their `.ts` files): `packages/nuxt-base/nuxt.config.ts` has an `alias` from each
  library a Nuxt package imports to its `src/index.ts`, which the typecheck, the Vite build and the Nitro build all use.
  A Nuxt package therefore needs no `build:deps`, and `workspaceConcurrency` is not set. A test checks both. Only the root
  `test` script runs the packages one at a time (`--workspace-concurrency=1`), because the database tests of db, api, worker and
  cli share one server-wide role lock; a test checks that too.
- **No `process.env` outside `config.ts`** (each app has one; `packages/db/src/migrate.ts` is the entry point that reads
  `MIGRATION_DATABASE_URL`). Config is validated with Zod at start-up and errors name variables, never values.
- **No secrets in the repo, an image, a compose file or a workflow.** `docker/.env.example` lists names with empty values.
- **One token is logged, on purpose: the setup token.** Everywhere else a token, a password or a key stays out of every log.
  At start-up, while the site is not installed, the api writes a new one-time setup token to the log, once, at `warn`
  (`announceSetupToken` in `apps/api/src/services/setup.ts`), because that is how the person who started the stack gets
  into `/admin/setup`. Only its hash is stored, a restart or `toa core setup-token` replaces it, and the install deletes it.
  It travels in the `X-Setup-Token` header, never in a query string the api or the proxy would log. The address that the log
  and `toa core setup-token` print carries it in the URL fragment (`/admin/setup#token=...`), which a browser never sends to a
  server; the wizard reads it from there. Do not add a second place
  that logs a token, and keep it out of every field of the log line (the test counts exactly one occurrence).
- **TypeScript.** Strict, no `any`, no `@ts-ignore`, no `enum`, no `console.*`; pino for logs. Tests live in `test/`.
- **Frontend.** Shared Nuxt code (API layer, API plugin, status component, runtime config, head basics, i18n setup) lives in
  `packages/nuxt-base`, once; an app keeps only what differs. Screen text goes through i18n: bokmål in
  `i18n/locales/nb.json` of the layer or the app, English keys, `t('…')` in templates and page heads, no literal string
  (a test reads the sources). Nuxt UI and Tailwind tokens, no `<style>` blocks, no arbitrary colours, no hard-coded user-facing
  constants that an admin should control (`app-config`: settings first).

## Public site: CSP and caching

The site and the admin share one security setup in `packages/nuxt-base` (`nuxt-security`: a CSP with a nonce per response, no
`unsafe-inline`, no `unsafe-eval`, HSTS from `X-Forwarded-Proto`). Each app adds only what differs: `img-src` (the site allows
`https:`, themes show pictures from other hosts), `frame-ancestors` (`'none'` on both, with `X-Frame-Options: DENY`: by Tor's
decision nothing is framed, the admin showing the site included, until the live preview of «Tilpass» in phase 3, which opens
the site to `'self'` and `SAMEORIGIN`), and the cache rule. Do not repeat a shared directive in an app: layers concatenate
arrays.

The admin also sets `style-src-attr` with `'unsafe-hashes'` and the hashes of the inline style strings that Nuxt UI and Reka UI
write into the server-drawn HTML (Tor's decision): `'unsafe-hashes'` for style attributes only, never in a script directive, and
not on the site. The strings are in one list, `ADMIN_STYLE_ATTRIBUTES` in `apps/admin/csp-style-attributes.ts`, each with its
reason; `nuxt.config.ts` hashes that list and nothing else. A test fails when a screen draws a string that is not on the list
(e.g. after a Nuxt UI upgrade) or the list holds one no screen draws. Use Nuxt UI's own controls; do not work around the policy
with native fields or `<ClientOnly>`. There is still no `'unsafe-inline'`.

- **A nonce and a page cache do not mix.** The nonce is in the HTML and in the header of one response. A shared cache that hands
  the same page to many visitors hands them a nonce anyone can read, and a known nonce protects nothing. So rendered pages are
  `Cache-Control: private, no-cache` on the site (`no-store` in the admin), set in each app's `server/plugins/security.ts`;
  `/_nuxt/**` assets are not rendered and keep their long cache.
- **When the site gets an SSR cache (phase 1), cache under the render, not the rendered page:** the data, blocks and API answers
  (by tag, as PLAN says), and let each request render its shell with its own nonce. If a whole page must be cached, give that
  hashes instead of a nonce (`nuxt-security` has `ssg.hashScripts` / `hashStyles` for prerendered pages; the inline scripts of a
  build are the same for every visitor, so their hashes are fixed; check how it behaves on a cached route before relying on it)
  and change the cache line of that route only. The site e2e
  (`apps/admin/e2e/site-headers.spec.ts`) pins the nonce and the cache header, so a cache that breaks the pairing fails there.
- A new inline script or style attribute needs its reason in `nuxt.config.ts`; a new third-party host needs its directive and
  its reason there too. Report-Only first (`security` §7) was replaced by a browser check of the built output: every e2e test fails on
  a CSP violation.

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

## Docker and the release workflow

- Images are built from `docker/<name>/Dockerfile` with the repo root as context. `compose.yaml` gives every image both
  `image:` and `build:`; users download only `compose.yaml` and `.env.example`, so it must never need a repo file at run
  time (the Caddyfile and the database roles are baked into the proxy and postgres images).
- `release.yml` and `pnpm release:check` build the images from `docker/compose.build.yaml` with `docker buildx bake` (bake resolves a compose file's build
  contexts relative to the directory it runs in, so `compose.yaml` cannot be its input). Keep the images, Dockerfiles and
  build arguments of the two files identical; a test checks it.
- Base images are pinned by tag and digest. Containers run as non-root, with `cap_drop: [ALL]`, `no-new-privileges`
  and a read-only root filesystem wherever the service allows it. Only the proxy publishes a port, bound to `127.0.0.1`
  unless `TOASCRIBE_HTTP_BIND` says otherwise. It believes `X-Forwarded-*` from the one address in
  `TOASCRIBE_TRUSTED_PROXY` and from nobody when that is empty; never `private_ranges` (a test checks it). Caddy reads
  `X-Forwarded-For` from the right (`trusted_proxies_strict`) and sends the result to every upstream in `X-Real-IP`.
  **The apps read the client IP from `X-Real-IP` only and never parse `X-Forwarded-For`** (M0.3 relies on it: login
  limits, `audit_log.ip`). A new `reverse_proxy` in the Caddyfile keeps `header_up X-Real-IP {client_ip}` (a test checks it).
- **One exception to "only the proxy publishes a port":** the `mailpit` compose profile (development only, off by default,
  nothing depends on it) publishes its web page on `127.0.0.1` only, through `TOASCRIBE_MAILPIT_PORT`; the SMTP port stays
  on the internal network. A test pins the loopback address. The worker's mail settings come from `SMTP_*` and
  `MAIL_FROM_*` in `docker/.env`. The five secrets (three passwords, `TOASCRIBE_ENCRYPTION_KEY`, `TOASCRIBE_SIGNING_KEY`)
  have an empty default in compose (no `:?`), so `toa core gen-env` can run before `.env` exists; the postgres entrypoint
  and the app configs refuse empty values.
- **No workflow runs on a push or a pull request.** There are two: `release.yml` (a `v*` tag, or «Run workflow» with an existing
  tag to run it again) and `audit.yml` (weekly and manual). The checks are local: `pnpm check` in the `pre-push` hook, and
  `pnpm release:check` (`scripts/release-check.sh`) before a release, which does what the old `ci.yml` did. A test pins the
  triggers and the list of workflow files.
- `release.yml` has three jobs, all on `ubuntu-latest`, written out (the repo is public: never the organisation's self-hosted
  runners or `vars.BUILD_RUNNER`). `build` (`contents: read`) checks the tag (`scripts/check-release-tag.sh`), builds,
  writes the images into an OCI layout by digest (`scripts/export-images.sh`), scans each digest with Trivy and uploads the
  layout. `publish` is the only job with `packages: write` and runs no third-party code (first-party `actions/*` and the
  runner's docker CLI only): it downloads the artifact by id and copies each image by the digest `build` scanned
  (`scripts/publish-images.sh`). `release` (`contents: write`) makes the GitHub Release, not for a `-rc` tag. Keep it so.
- Workflows: third-party actions are pinned to a full commit SHA with the version in a comment, checked against the action's
  own repository; `permissions: contents: read` at the top; `persist-credentials: false` on every checkout; event values go
  through `env:`, never inline `${{ }}` in a script. Run `actionlint` on every workflow you touch (`scripts/install-tools.sh`
  installs the pinned version).

## Git

The flow is local first (GIT_STANDARD_2026, VERSIONING_STANDARD_2026 §4): a local branch, commits per step, `pnpm check`,
a local merge into `main`, and a push that is only a backup (it starts nothing). A release is `pnpm release:check` on `main`,
a `chore(release): vX.Y.Z` commit, an annotated tag and `git push --follow-tags`; the tag is what builds and publishes.

- Commit on a local branch. Landing (merge into `main`, push `main`, delete the branch) follows GIT_STANDARD «Landing»: the
  reviewer approved or no review was needed, `check` is green, the tree is clean and `main` equals `origin/main`. Stop and
  report on a conflict, a red check or a refused push. A change to `.github/workflows/` is landed only when Tor says so in
  his own message; a brief from another agent is not that.
- **Tags are Tor's.** Never create or push a tag, never run «Run workflow», never create a GitHub Release by hand. Never
  rebase or force-push `main`; the `pre-push` hook refuses a force push to `main` and a moved or deleted `v*` tag.
- Conventional Commits in English, branches named `<type>/<description>`, never commit to `main`.

## Deploy

Spor: ingen — produkt; release med tag (VERSIONING_STANDARD_2026 §4, DEPLOYMENT_STRATEGY «Overgang til release med tag»)

toascribe is a product that others run; this repo deploys nowhere. There is no `deploy.yml` and no server. Developed and
checked locally (`pnpm check`, run by pre-push). Push is backup. Release, when Tor says a batch is ready:

1. `pnpm release:check` on `main`, from a clean tree (actionlint, audit, `pnpm check` with the database and e-mail tests,
   image build, Trivy, the route checks around `toa core install`, a publish dry run, the e2e suite).
2. `chore(release): vX.Y.Z`: the version in the root `package.json` and its mirrors (every workspace `package.json`, the
   `TOASCRIBE_VERSION` default in `docker/compose.yaml`, `docker/compose.build.yaml` and `docker/.env.example`; tests check
   them), and `## [Unreleased]` renamed to `## [X.Y.Z] - YYYY-MM-DD` with a new empty `## [Unreleased]` above it.
   `scripts/check-release-tag.sh vX.Y.Z` must pass on that commit.
3. Tor: `git tag -a vX.Y.Z -m vX.Y.Z` and `git push --follow-tags`. `release.yml` builds, scans, publishes
   `ghcr.io/toaweb-development/toascribe-*` (version tag and `sha-<short>`) and creates the GitHub Release. A failed scan
   publishes nothing. A tag is never moved: a fix is a new PATCH tag; a run that failed outside the code is run again with
   «Run workflow» and the same tag.

No bump and no CHANGELOG version per task: changes are written under `## [Unreleased]` as they land. Docs, tests and workflow
changes alone need no release.

## Known deviations — pending owner decision

These are choices Tor has not made yet. Say which one you hit if your work touches it.

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
