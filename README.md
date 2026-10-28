# toascribe

toascribe is a self-hosted publishing system that does what WordPress does today (posts, pages, media, users, themes
and plugins), written in TypeScript from end to end: Nuxt 4 for the site and the admin, a Hono API on Node, and
PostgreSQL. Content is stored as structured blocks, not HTML, and background work runs on a real job queue. It ships
as an open repository and starts with Docker; the rest of the setup is finished in a browser wizard.

**Status: 0.5.0, admin shell.** The whole stack starts and is healthy on one port, and a fresh install is finished in a browser
wizard at `/admin/setup` (or with `toa core install`): system check, site, e-mail, the administrator and a recovery key, with
a WordPress-style first post and page. People can log in at `/admin/login` (and at `/wp-login.php`, which redirects), with
sessions, a second factor, lost password and registration, and e-mail goes through the job queue. Once signed in, the admin
has a menu, a dashboard with notices, a profile page and a users list with role assignment. The images are published
to `ghcr.io/toaweb-development`. There is no editor yet. The plan, the architecture and the phases are in
[docs/PLAN.md](docs/PLAN.md) (in Norwegian); the tables are described in [docs/DATAMODEL.md](docs/DATAMODEL.md).

## Run the stack

You need Docker with Compose v2.

```sh
# 1. Make the three passwords and the two keys, once. The lines are appended to docker/.env (made if it is not there):
docker compose -f docker/compose.yaml run --rm --no-deps -T --quiet-build api toa core gen-env >> docker/.env
# 2. Start everything:
docker compose -f docker/compose.yaml up -d --build
```

Step 1 needs no database and no other setting; the first time it builds the `api` image, which takes a few minutes
(`--quiet-build` keeps the build output out of the file, `-T` keeps terminal control characters out of it). Run it once per
installation: a second run would repeat the five names, and the passwords and the keys that are already in use must not
be replaced this way. `docker/.env.example` lists every other setting (e-mail, ports, the reverse proxy); copy the lines you
need into `docker/.env`. Do not copy the whole file over it: it has the five names with empty values.

Then open <http://localhost:8080>.

| Address       | What it is                                                  |
| ------------- | ----------------------------------------------------------- |
| `/`           | the site                                                    |
| `/admin`      | the admin app                                               |
| `/setup`      | the first-run wizard; it redirects to `/admin/setup`        |
| `/api/health` | 200 when the API is up                                      |
| `/api/ready`  | 200 when the API can reach the database, 503 when it cannot |

There are no default passwords or keys. A start with one missing stops at once, with the name of the variable: postgres says
`toascribe-postgres: POSTGRES_APP_PASSWORD is empty` (see `docker compose logs postgres`), and the API and the worker say
`Invalid environment: TOASCRIBE_ENCRYPTION_KEY: ...` in their logs. Compose itself reads the file without them, which is
what lets step 1 run on a fresh folder. The migrations run in their own step (`migrate`) before the API and the worker
start.

**Two keys, made once.** `TOASCRIBE_ENCRYPTION_KEY` encrypts the secrets the database holds (TOTP secrets, the SMTP
password); `TOASCRIBE_SIGNING_KEY` signs the CSRF tokens, and must be a different value. **Back the encryption key up
outside the server:** without it those values cannot be read again. To replace it without losing data, put the new key in
`TOASCRIBE_ENCRYPTION_KEY`, raise `TOASCRIBE_ENCRYPTION_KEY_VERSION` by one and put the old key in
`TOASCRIBE_ENCRYPTION_OLD_KEYS` as `v<its version>:<key>`.

**E-mail.** The worker sends mail through an SMTP server you name in `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
`SMTP_USERNAME` and `SMTP_PASSWORD`, from `MAIL_FROM_ADDRESS` and `MAIL_FROM_NAME`. These are the defaults; a setting saved
in the admin wins. Until a host and a sender address are set, mails wait in the queue and are retried.

**Old WordPress addresses.** `/wp-login.php` goes to `/admin/login` with its query string (so `?action=lostpassword`
survives), and `/wp-admin` and everything under it go to `/admin`; `/login`, `/register` and `/logout` go to the same
pages under `/admin`. All are permanent redirects (308) made by the proxy.

**The database passwords are set once.** `docker/postgres/10-init.sh` runs `init.sql` (it creates the roles
`toascribe_owner` and `toascribe_app`) only when postgres starts on an empty volume, the first time. After that, changing
`POSTGRES_PASSWORD`, `POSTGRES_OWNER_PASSWORD` or `POSTGRES_APP_PASSWORD` in `docker/.env` changes nothing in the
database, and the API and worker fail to log in. To change one, set it in the database first and then in `.env`. The new
value goes in through the environment, so it is in neither the command line nor your shell history:

```sh
read -rs -p 'New password for toascribe_app: ' NEWPW; echo; export NEWPW
docker compose -f docker/compose.yaml exec -T -e NEWPW postgres psql -U postgres -d toascribe -v ON_ERROR_STOP=1 <<'SQL'
\getenv newpw NEWPW
ALTER ROLE toascribe_app PASSWORD :'newpw';
SQL
unset NEWPW
# now put the same value in POSTGRES_APP_PASSWORD in docker/.env and restart:
docker compose -f docker/compose.yaml up -d
```

Use `toascribe_owner` for the owner password, and `postgres` for `POSTGRES_PASSWORD` (the superuser is named by
`POSTGRES_USER`). On a throwaway install it is simpler to start over with a fresh volume:
`docker compose -f docker/compose.yaml down -v`, edit `.env`, `up -d`.

- **Behind Traefik or nginx.** See "Behind a reverse proxy" below: the port is bound to `127.0.0.1` by default and you
  tell the stack which proxy to believe.
- **Update.** `docker compose -f docker/compose.yaml pull && docker compose -f docker/compose.yaml up -d`, with
  `TOASCRIBE_VERSION` in `docker/.env` set to the new version. Images are published at each release (from 0.4.1); a clone can
  also `git pull` and `up -d --build`.
- **Valkey** (cache) is optional and not used yet: `COMPOSE_PROFILES=valkey` in `docker/.env`.
- **Mailpit** (for development) catches every mail instead of sending it: `COMPOSE_PROFILES=mailpit` in `docker/.env`, or
  `docker compose -f docker/compose.yaml --profile mailpit up -d`, with `SMTP_HOST=mailpit`, `SMTP_PORT=1025`,
  `SMTP_SECURE=none` and a `MAIL_FROM_ADDRESS` set (see `docker/.env.example`). Its inbox is at
  <http://127.0.0.1:8025> (`TOASCRIBE_MAILPIT_PORT` changes the port). It is the one published port besides the proxy's,
  bound to this machine's loopback only, and the page has no login: do not use the profile on a server.
- **The CLI** runs in the API container: `docker compose -f docker/compose.yaml exec api toa --version`. Exit codes: `0`
  success, `1` an error underway (the database does not answer, the site is already installed, a name is taken), `2` invalid
  input or usage (an unknown flag, a missing value, a refused password, a bad environment). `toa core is-installed` is the one
  exception: 0 installed, 1 not installed, 2 error. `toa` with no arguments lists them. `toa post|term|menu|option` act as an
  account (`--user <login>`), with its rights and the admin's checks; every change is audited with «cli» as the actor.
- **Stop.** `docker compose -f docker/compose.yaml down` (add `-v` to delete the database volume as well).

### Backups

One file, `toascribe-<date>-<time>Z-<version>.tar.zst`, holds the database (`pg_dump -Fc`), the uploads and `manifest.json` (the
version, the last migration, the time and a sha256 per part). Files are mode 0600 in the `backups` volume; copy them off the host.

```sh
docker compose exec api toa backup create            # also: list, verify <file>, prune [--keep N]
docker compose stop api worker                       # a restore replaces the database and the uploads
docker compose run --rm migrate toa backup restore <file> --dry-run   # checks it, changes nothing
docker compose run --rm migrate toa backup restore <file>             # asks; --yes for a script
docker compose up -d
```

- **toascribe.toml.** Point `TOASCRIBE_CONFIG_DIR` in `.env` at a folder with `toascribe.toml`; its `[backup]` section sets
  `schedule = true` (the worker makes one a day at 03:30 UTC and keeps the newest `keep`, 7 by default), `encrypt = true` and
  `recipient = "age1..."` (every backup encrypted with [age](https://age-encryption.org) to that public key).
- **Secrets stay out** unless you ask: `--include-secrets` adds the encryption and signing keys, and is refused without a
  `recipient`, so they are never stored unencrypted. A restore writes them to a 0600 file beside the backups, never to `.env`.
  An encrypted backup is read with `--identity <file>` (the age private key, mounted into the container).
- **A restore** checks every sha256 and the manifest before anything changes, refuses a backup from a newer version, migrates
  an older one up, keeps the site in maintenance mode while it runs and turns it back off after, also when it fails.
- **Moving or recovering:** see [docs/RESTORE.md](docs/RESTORE.md). Keep the recovery key from the setup wizard and a
  `toa secrets export` file with the backups: a new server needs them to read the stored secrets.
- **Updates.** «Kontrollpanel → Oppdateringer» says when a new release is out (the worker asks ghcr.io once a day for the public
  image tags, sending nothing about the site; `TOASCRIBE_UPDATE_CHECK=off` stops it). Update on the host with
  `docker compose pull && docker compose up -d`. `migrate` runs `toa db migrate`: when a migration is pending on a site with content, it makes a backup first
  and stops if that fails. `toa db migrate --no-backup` (or `toa core update --no-backup`) skips it, with a warning.

## Installer uten å klone repoet

The images are published to `ghcr.io/toaweb-development/toascribe-*` at each release, so a server needs only `compose.yaml` and `.env`
(Docker with Compose v2). Take `compose.yaml` from the release tag you want (the newest is at the top of
[the tags](https://github.com/toaweb-development/toascribe/tags)); it starts the images of that version:

```sh
mkdir toascribe && cd toascribe
version=X.Y.Z   # the release you install, e.g. 0.6.0
curl -fsSLO "https://raw.githubusercontent.com/toaweb-development/toascribe/v${version}/docker/compose.yaml"
docker compose pull                                                # first: see below
docker compose run --rm --no-deps -T api toa core gen-env >> .env  # the passwords and keys, once
echo 'PUBLIC_ORIGIN=https://example.com' >> .env                   # the address visitors use; default http://localhost:8080
docker compose up -d
docker compose logs api | grep -o 'https\?://[^ ]*/admin/setup#token=[A-Za-z0-9_-]*'
```

Open the address the last command prints: `/admin/setup#token=...` is the setup wizard, and the token in it is good for
that one setup. A new one is made at the next start of the API, or with `docker compose exec api toa core setup-token`.
Add `TOASCRIBE_HTTP_PORT=...` (and the other settings in [docker/.env.example](docker/.env.example), at the same address as
`compose.yaml` in the tag) to `.env` the same way.

- **Pull first.** `compose.yaml` also carries the build instructions of a clone. In a folder with no sources, `run` or `up`
  with an image missing would try to build and fail; `docker compose pull` fetches the images and nothing builds.
- **Another version:** take `compose.yaml` from that tag, or set `TOASCRIBE_VERSION=<version>` in `.env`.
- **Behind Traefik or nginx:** see the next section; `PUBLIC_ORIGIN`, `TOASCRIBE_HTTP_BIND` and `TOASCRIBE_TRUSTED_PROXY`
  go in `.env` as above.

## Behind a reverse proxy

The stack speaks plain HTTP on one port; TLS belongs to your Traefik or nginx, which sends all traffic to that port. Set
`PUBLIC_ORIGIN` in `docker/.env` to the public address (`https://example.com`). Two more variables decide who may reach
the port and whose word the stack takes about the visitor:

| Variable                  | Default     | What it does                                                                                   |
| ------------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `TOASCRIBE_HTTP_BIND`     | `127.0.0.1` | Host address the port is bound to. `0.0.0.0` exposes it on every interface.                    |
| `TOASCRIBE_TRUSTED_PROXY` | empty       | The one IP address or CIDR network whose `X-Forwarded-For`, `-Proto` and `-Host` are believed. |

**Why.** Those three headers say who the visitor is and whether the page was opened over HTTPS. If the stack believed
them from anyone who can reach the port, a visitor could send `X-Forwarded-For: 1.2.3.4` and pass for another address,
which defeats rate limits and audit logs, or claim `https` to get past secure-cookie and redirect logic. So the default
trusts nobody: the stack replaces those headers with what it sees itself. Set `TOASCRIBE_TRUSTED_PROXY` to your proxy,
and only to your proxy: one address, not `private_ranges` and not a network such as `10.231.97.0/24` or `10.0.0.0/8`,
which would include every container and host process that can reach the port. Empty is safe but then every request
appears to come from the proxy.

**The warning when it is empty.** The api cannot tell a stack without a proxy from one whose variable was forgotten, so
it watches. While `TOASCRIBE_TRUSTED_PROXY` is empty it looks at the `X-Real-IP` of its first 50 requests (or, on a
quiet site, of the first ten once ten minutes have passed). If they all carry the same private address (10.x, 172.16-31.x,
192.168.x, 127.x, 100.64-127.x, `fc00::/7`), it writes one `warn` line to the api log, naming the variable:
«TOASCRIBE_TRUSTED_PROXY is empty and the first 50 requests all came from the same private address». That means all your
visitors share **one** rate-limit bucket (a few wrong logins from anyone make everyone wait) and every IP address in the
audit log and the session list is your reverse proxy. Set the variable as described below, then run
`docker compose up -d api proxy`. No warning is written when the variable is set, when two different addresses show up,
or when an address is public. The system check in the setup wizard shows the same finding, and Site Health will later.

**How the client address is found.** The stack reads `X-Forwarded-For` from the right and stops at the first address
that is not the trusted proxy (Caddy's `trusted_proxies_strict`), so entries a visitor writes at the front are ignored.
It then sends that one address to the apps in `X-Real-IP`, replacing any `X-Real-IP` the visitor sent. The apps read
the client address from `X-Real-IP` only. Even so, make your proxy overwrite `X-Forwarded-For` (the nginx example
below) rather than append to it: then the header holds one address you can trust.

The `edge` network has a fixed subnet (`TOASCRIBE_EDGE_SUBNET`, default `10.231.97.0/24`) so that the address to trust
is known. What the stack sees (measured with Caddy 2.11.7 and Docker 29):

| Your proxy runs                                                           | Point it at                     | The stack sees it as                 | `TOASCRIBE_TRUSTED_PROXY`  |
| ------------------------------------------------------------------------- | ------------------------------- | ------------------------------------ | -------------------------- |
| in a container on this host                                               | `http://toascribe-proxy-1:8080` | the fixed address you give it        | that one address (below)   |
| on this host, outside Docker (or with host networking)                    | `http://127.0.0.1:8080`         | `10.231.97.1`, the gateway of `edge` | `10.231.97.1` (see caveat) |
| on another machine (set `TOASCRIBE_HTTP_BIND` to an address of this host) | that address and the port       | its own address                      | that address               |

**A proxy in a container.** Give it a fixed address on `edge`, in its own compose file, and trust exactly that
address. Pick one near the top of the subnet: Docker hands out the low addresses to containers that have no fixed one.
The network is called `<project>_edge`; for the default project name that is `toascribe_edge` (see
`docker network ls`).

```yaml
# The proxy's own compose file (here nginx; Traefik is the same idea).
services:
  nginx:
    image: nginx:stable-alpine
    networks:
      toascribe_edge:
        ipv4_address: 10.231.97.250
networks:
  toascribe_edge:
    external: true
```

Then `TOASCRIBE_TRUSTED_PROXY=10.231.97.250` in `docker/.env`. Another container that joins `edge` is not trusted and
cannot forge the headers.

**A proxy on the host.** The gateway value `10.231.97.1` is only valid with `TOASCRIBE_HTTP_BIND=127.0.0.1` (the
default) and rootful Docker. In that setup every process on this host that connects to `127.0.0.1:8080` appears as
`10.231.97.1`, so trusting it trusts the whole host; that is fine on a host you control. With `TOASCRIBE_HTTP_BIND` set
to `::` or `0.0.0.0`, or with rootless Docker, a remote visitor can appear as the gateway too, so do not trust it
there: run the proxy in a container instead.

To check which address the stack sees, send one request and read `remote_ip` and `client_ip` in
`docker compose -f docker/compose.yaml logs proxy --tail 1`. If Docker answers "Pool overlaps" for the `edge` subnet,
set `TOASCRIBE_EDGE_SUBNET` to a free range and adjust the addresses above.

**nginx.** The `location` below overwrites the forwarding headers instead of adding to them. Use `$remote_addr`, not
`$proxy_add_x_forwarded_for`, which would keep whatever the visitor sent. If nginx itself sits behind a CDN or another
proxy, restore the real address first with the `realip` module, so that `$remote_addr` is the visitor.

```nginx
location / {
    proxy_pass http://toascribe-proxy-1:8080;   # or http://127.0.0.1:8080 for nginx on the host
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
}
```

Traefik replaces the forwarding headers it gets from an untrusted client by default; leave `forwardedHeaders.trustedIPs`
and `insecure` unset on the entry point unless a proxy in front of Traefik needs them.

## Develop

You need Node 24 (see `.node-version`, at least 24.12), Docker, and pnpm. pnpm's version is pinned by `packageManager`
in `package.json`; `corepack enable` picks it up.

```sh
pnpm install
pnpm exec lefthook install   # optional: the pre-push hook that refuses a force push to main and a moved v* tag
```

**The checks.** One command runs format check, lint, typecheck, test and build for every workspace package and for the
root files (`eslint`, `tsc` and the `root` Vitest project):

```sh
pnpm check
```

Run it before you merge into `main`. No hook is required and nothing is pushed between releases: `scripts/release.sh` is the
gate, and no workflow runs on a push or a pull request.

Lint, typecheck and the tests read the workspace libraries from `src/` (the `source` export condition), so nothing needs
building first. Node and the images still run the compiled `dist/`. The `dev` scripts of the api and worker build the
libraries first, because `node --watch src/index.ts` loads them from `dist/`. The Nuxt apps and layers read them from
`src/` too (an alias in `packages/nuxt-base`), so they build nothing first.

**A database for the tests.** The database tests need a superuser URL on a disposable PostgreSQL 18; they create and
drop their own databases and roles on it. Without `TEST_DATABASE_URL` they skip and say so, so a green `pnpm check`
without it has not run them.

```sh
password="$(openssl rand -hex 16)"
docker run -d --rm --name toascribe-test-db -e POSTGRES_PASSWORD="$password" -p 127.0.0.1:55432:5432 postgres:18-alpine
export TEST_DATABASE_URL="postgres://postgres:$password@127.0.0.1:55432/postgres"
pnpm check
docker stop toascribe-test-db
```

**End-to-end tests.** `pnpm test:e2e` drives the sign-in screens in a real browser (Chromium, at 375 and 1280 px, with
an accessibility check) against a full stack with Mailpit. It is not part of `pnpm check`, because it needs Docker and
takes a few minutes. `apps/admin/e2e/stack.sh` starts a stack of its own (own project name, ports and volumes; your
`docker/.env` is not touched):

```sh
pnpm --filter @toascribe/admin exec playwright install chromium   # once
apps/admin/e2e/stack.sh up
pnpm test:e2e
apps/admin/e2e/stack.sh down
```

[apps/admin/e2e/README.md](apps/admin/e2e/README.md) has the details.

**The release check: `pnpm release:check`.** `scripts/release.sh` runs it (see «Release»), and it can run on its own. One
command does on this machine what CI used to do, from a clean working tree (it refuses a dirty one): `actionlint`, `pnpm check` with a throwaway PostgreSQL 18 and Mailpit (so the
database and e-mail tests run), every image built with provenance and SBOM attestations into a throwaway registry, a Trivy
scan of each one (Critical and High with a known fix fail), the stack started from the scanned images with the route checks
before, during and after `toa core install`, a dry run of the publishing into a second throwaway registry, and the full
end-to-end suite. It takes a while (the first run builds everything) and removes what it started, also after a failure.
`RELEASE_CHECK_*` variables at the top of `scripts/release-check.sh` move its ports when a default is taken.

```sh
pnpm release:check
```

**The apps in dev mode.** They need a database that has the toascribe roles, which the postgres image of the stack
creates on its first start:

```sh
docker build -f docker/postgres/Dockerfile -t toascribe-postgres-dev .
owner="$(openssl rand -hex 16)"; app="$(openssl rand -hex 16)"
docker run -d --name toascribe-dev-db -e POSTGRES_DB=toascribe -e POSTGRES_PASSWORD="$(openssl rand -hex 16)" \
  -e POSTGRES_OWNER_PASSWORD="$owner" -e POSTGRES_APP_PASSWORD="$app" \
  -p 127.0.0.1:5432:5432 -v toascribe_dev_data:/var/lib/postgresql toascribe-postgres-dev

# .env in the repo root is read by the api and worker dev scripts (and is git-ignored)
printf 'DATABASE_URL=postgres://toascribe_app:%s@127.0.0.1:5432/toascribe\nPUBLIC_ORIGIN=http://localhost:3000\nTOASCRIBE_ENCRYPTION_KEY=%s\nTOASCRIBE_SIGNING_KEY=%s\n' \
  "$app" "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .env
MIGRATION_DATABASE_URL="postgres://toascribe_owner:$owner@127.0.0.1:5432/toascribe" pnpm --filter @toascribe/db migrate

pnpm --filter @toascribe/api dev     # http://localhost:3001/api/health
pnpm --filter @toascribe/worker dev  # the job queue worker
pnpm --filter @toascribe/site dev    # http://localhost:3000, /api is proxied to the API
pnpm --filter @toascribe/admin dev   # http://localhost:3002/admin
```

### Verktøy for release:check

Besides Docker (with compose and buildx 0.33 or newer), Node and pnpm, it needs `trivy` and `actionlint`, and Playwright's
Chromium (`pnpm --filter @toascribe/admin exec playwright install chromium`). It stops at the start and names what is
missing. `scripts/install-tools.sh` installs the two tools as single binaries in `~/.local/bin` (no sudo, no package manager):
the versions are pinned in the script with the sha256 of each Linux x86-64 archive, taken from the project's own checksums
file, and a download with another checksum is refused. Run it again after changing a pin; it skips a tool that is already at
the pinned version. `~/.local/bin` must be on `PATH`.

```sh
scripts/install-tools.sh   # trivy and actionlint, pinned by version and sha256
trivy --version && actionlint -version
```

### Release

Changes are written under `## [Unreleased]` in `CHANGELOG.md` as they land; there is no bump per task. When a batch is ready
on `main` (a clean tree):

```sh
git cliff --unreleased --strip header   # a draft of the CHANGELOG text; edit it for people
# turn ## [Unreleased] into ## X.Y.Z — YYYY-MM-DD (long dash, ISO date) and commit it
scripts/release.sh --dry-run X.Y.Z      # the checks, pnpm release:check and the audit; changes and pushes nothing
scripts/release.sh X.Y.Z                # the release
```

`scripts/release.sh` (VERSIONING_STANDARD_2026 §4.1) refuses unless it is on a clean `main` with a higher version and the
CHANGELOG section. It runs `pnpm release:check` and the audit (`scripts/audit.sh`), writes the version into the root
`package.json` and its mirrors, commits `release: vX.Y.Z`, makes the annotated tag and pushes `main` and the tag in one atomic
push. If anything fails, nothing is pushed. `X.Y.Z-rc.N` makes a prerelease without a CHANGELOG section.

The tag starts `.github/workflows/release.yml`, the only workflow: it builds and scans the images (no write access) and
publishes the scanned images by digest to `ghcr.io/toaweb-development/toascribe-*` (the only job that can write packages).
There is no GitHub Release: the release is the tag, and its text is the tag's `CHANGELOG.md`. A tag is never moved; a run
that failed outside the code is run again with «Run workflow» and the same tag.

## Layout

| Folder                         | What is in it                                                              |
| ------------------------------ | -------------------------------------------------------------------------- |
| `apps/api`, `apps/worker`      | the Hono API and the pg-boss worker (one image, two commands)              |
| `apps/site`, `apps/admin`      | the two Nuxt apps                                                          |
| `packages/db`                  | Drizzle client, migrations and the migration runner                        |
| `packages/shared`              | Zod schemas and types shared by the API and the apps                       |
| `packages/auth`                | password hashing (argon2id, WordPress hash import) and one-time tokens     |
| `packages/http`                | an HTTP client that refuses private addresses (SSRF-safe `safeFetch`)      |
| `packages/nuxt-base`           | the Nuxt layer both apps share (Nuxt UI, i18n, API layer, config)          |
| `packages/sdk`, `ui`, `blocks` | placeholders for the plugin and theme SDK, shared UI and block definitions |
| `themes/default`               | the default theme, a Nuxt layer                                            |
| `cli`                          | the `toa` command                                                          |
| `docker`                       | Dockerfiles, `compose.yaml`, `.env.example`, the Caddyfile, database roles |
| `scripts`                      | `release.sh`, `release:check`, the audit, the image copy, tools            |

## More

[CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [CHANGELOG.md](CHANGELOG.md) · [AGENTS.md](AGENTS.md) ·
[LICENSE](LICENSE) (MIT)
