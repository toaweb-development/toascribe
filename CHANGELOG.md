# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) ·
Versioning: [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-10-22

Sign-in: people can now log in, stay logged in safely, reset a lost password and use a second factor. **Action needed on
upgrade:** two new keys are required, see the first item under Changed.

### Added

- Login that works like `wp-login.php`: one address, `/admin/login`, with the screens for lost password, new password,
  registration, second factor and e-mail confirmation behind it. `/login`, `/register`, `/logout` and `/wp-login.php`
  (with its `action` values) redirect there and keep the query.
- Passwords are stored with argon2id. A WordPress password hash (phpass `$P$`, or bcrypt as `$2y$` and `$wp$2y$`) is
  accepted at login and replaced with argon2id the first time it is used, so an imported user keeps the old password.
- Sessions in a `__Host-` cookie that scripts cannot read and that only the same site can send, with a CSRF token on every
  write. «Husk meg» keeps a session for 14 days instead of 2; both are settings.
- A capability policy on every API route. A route without one does not compile, is caught by a test, and stops the API
  from starting.
- Login limits per account and per address, with a lock-out that doubles up to a day. Every number is a setting.
- Two-factor login with an authenticator app (TOTP) and ten recovery codes, set up on screen with a QR code. A role can
  require it (`mfa_required_roles`), and then the person must set it up before anything else.
- Lost password, registration and e-mail change through one-time links that work once and expire. The answers never
  tell whether an account exists.
- E-mail through the job queue and SMTP, with bokmål templates. The server is set in `.env` and can be overridden in
  settings, where the SMTP password is stored encrypted. `docker compose --profile mailpit up` adds Mailpit, which
  catches all mail for development and is published on `127.0.0.1` only.
- A test e-mail endpoint for the administrator (`POST /api/v1/system/test-email`).
- Daily clean-up jobs in the worker: ended sessions and spent links, IP addresses past the retention, and spam
  comments past theirs. IP addresses are kept 90 days by default; one setting, `ip_retention_days`, covers sessions,
  comments, application passwords, login attempts and the audit log.
- `@toascribe/http`: an HTTP client that refuses private, loopback and link-local addresses at connect time, on every
  redirect, and limits size and time.
- `@toascribe/auth`: password hashing and one-time tokens, shared by the API and the command line.
- `toa user create` and `toa user reset-password`. The password comes from standard input or is generated and printed
  once; it is never taken from an argument.
- Login screens in the admin, in bokmål, tested in a real browser at phone and desktop widths with an accessibility check
  (`pnpm test:e2e`, see the README).

### Changed

- **Action needed on upgrade:** `TOASCRIBE_ENCRYPTION_KEY` and `TOASCRIBE_SIGNING_KEY` are new and required, and
  `docker compose up` stops without them. Generate both before you start (`openssl rand -hex 32`, a different value
  each) and put them in `docker/.env`. **Back up the encryption key outside the server:** TOTP secrets and the SMTP
  password cannot be read without it. `TOASCRIBE_ENCRYPTION_KEY_VERSION` and `TOASCRIBE_ENCRYPTION_OLD_KEYS` let you
  replace the key without losing data.
- **BREAKING:** the editor role no longer has `unfiltered_html`, and `administrator` can no longer be the default role
  for new accounts (`default_role` refuses it). Migration `0003_rights_ip_retention` applies both once on an
  existing database: it removes `unfiltered_html` from the built-in editor role only (a role you made yourself is left
  alone), and sets `default_role` back to `subscriber` if it was `administrator`. Each change is written to the audit
  log. The administrator can grant `unfiltered_html` to a role again.
- The IP clean-up reads `ip_retention_days` (7 to 3650, default 90) instead of a fixed 90 days.
- The admin sends a strict Content-Security-Policy with a nonce per response, and no cached pages.
- Compose publishes one more port in the Mailpit profile (`127.0.0.1:8025`), off by default. Its image is
  `ghcr.io/toaweb/toascribe-mailpit`: Mailpit 1.31.6 with the binary rebuilt on Go 1.27.3.

### Security

- Nothing the admin serves can run inline script or style: no `unsafe-inline`, no `unsafe-eval`, no framing.
- An unknown account and a wrong password look the same to the visitor, as do an unknown address on lost password and an
  address that is already registered.
- Reset and confirmation links are read from the address fragment and removed from the address bar at once, so they do
  not reach logs or the `Referer` header.
- A TOTP code works once (RFC 6238 replay protection), and a password reset ends every session of the account.
- The address to return to after login must be a path on the same site; anything else, including encoded tricks, is
  refused.
- The mail server settings cannot carry line breaks into a mail header.

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

[Unreleased]: https://github.com/toaweb/toascribe/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/toaweb/toascribe/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/toaweb/toascribe/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/toaweb/toascribe/releases/tag/v0.1.0
