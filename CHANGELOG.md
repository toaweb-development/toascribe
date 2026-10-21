# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) ·
Versioning: [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/toaweb/toascribe/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/toaweb/toascribe/releases/tag/v0.1.0
