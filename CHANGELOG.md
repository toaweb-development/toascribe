# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) ·
Versioning: [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-10-21

The data model: the database now holds everything a site needs, and a fresh stack starts with roles and settings in place.

### Added

- The core data model: 43 tables in two migrations, with time-ordered ids, a short numeric id for `/?p=` links, named
  foreign keys and indexes for JSON content and search. The app role gets data rights only. On the audit log it has
  only insert and select, and every entry names its actor. IP addresses on the audit log are cleared after 90 days by
  a database function that the app role may only execute. [docs/DATAMODEL.md](docs/DATAMODEL.md) has the ER diagram,
  the draft and revision model and where it departs from the plan.
- `seedCore()`: the five WordPress roles with WordPress' capabilities and 51 default settings (Norwegian date, time
  and timezone, locale `nb`, WordPress permalinks, comments open). The migrate step runs it after the migrations and
  never overwrites a row that exists, so a fresh `docker compose up` ends with roles and settings in place.
- `toa dev seed tom`: resets a development database to the migrated and seeded state. It refuses unless `NODE_ENV` is
  `development` or `test`.
- `packages/nuxt-base`: one Nuxt layer shared by the site and the admin (API plugin, status component, runtime config,
  head basics).
- Norwegian bokmål as the first interface language, through `@nuxtjs/i18n`. All screen text goes through messages, and a
  test fails on hard-coded text in templates.
- `pnpm check`: format, lint, type check, tests and build, including the root files, in one command. CI and the docs
  use it; the pre-commit hook runs the lint and type check part (`pnpm lint && pnpm typecheck`).
- A `source` export condition on the workspace libraries, so lint, type check and tests read `src/` without building
  first. Node still loads `dist/`.

### Changed

- **BREAKING:** the proxy publishes its port on `127.0.0.1` by default. Set `TOASCRIBE_HTTP_BIND` to expose it on
  another address.
- Lint, type check and tests no longer need the libraries built first, so the root `build:libs` step and the single-worker
  setting are gone.
- The version gate ignores changes that only touch tests.

### Security

- The proxy believes `X-Forwarded-For`, `-Proto` and `-Host` only from the address in `TOASCRIBE_TRUSTED_PROXY`, and
  replaces them with what it sees itself otherwise. The edge network has a fixed subnet.
- The proxy reads `X-Forwarded-For` from the right (`trusted_proxies_strict`), so entries a visitor writes in front of
  the real address are ignored, and sends the client address to the apps in `X-Real-IP`, which the apps read instead
  of `X-Forwarded-For`. The README shows an nginx setup that overwrites the header and asks for one trusted address
  only, never a network.
- Paths that are not normalised are rejected with 400.
- The database init script passes the role passwords to psql with `\getenv`, so they no longer show in the process
  list.
- gosu is pinned to a commit, and the optional Valkey image is pinned and scanned like the others.

## [0.1.0] - 2026-10-20

The skeleton: everything runs end to end, nothing is a feature yet.

### Added

- A pnpm workspace with TypeScript 6, ESLint, Prettier, Vitest and one version for every dependency.
- `packages/db`: the Drizzle client, a migration runner that takes a database lock and also installs the pg-boss
  schema, and the two PostgreSQL roles (owner for migrations, app role with no DDL rights).
- `apps/api`: a Hono API with `/api/health`, `/api/ready` and an OpenAPI document, and `apps/worker`: a pg-boss
  worker with a heartbeat healthcheck. Both shut down cleanly on SIGTERM.
- `apps/site` and `apps/admin`: two Nuxt 4 apps that show the API status, and the default theme as a Nuxt layer.
- The `toa` command, with `--version`.
- `docker/compose.yaml`: the whole stack on one port, with a Caddy proxy that routes `/api`, `/admin` and the site,
  a migrate step that runs before the API, and optional Valkey. Compose refuses to start with an empty password.
- CI: lint, type check, tests (against PostgreSQL 18), build, image build, vulnerability scan of the images and the
  dependencies, a start of the full stack, and a version gate that asks for a new version and CHANGELOG entry when
  released files change.

[Unreleased]: https://github.com/toaweb/toascribe/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/toaweb/toascribe/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/toaweb/toascribe/releases/tag/v0.1.0
