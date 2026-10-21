# toascribe

toascribe is a self-hosted publishing system that does what WordPress does today (posts, pages, media, users, themes
and plugins), written in TypeScript from end to end: Nuxt 4 for the site and the admin, a Hono API on Node, and
PostgreSQL. Content is stored as structured blocks, not HTML, and background work runs on a real job queue. It ships
as an open repository and starts with Docker; the rest of the setup is finished in a browser wizard.

**Status: 0.1.0, the skeleton.** The whole stack starts and is healthy on one port, the apps talk to the database, and
the API answers `/api/health` and `/api/ready`. There is no content model, login or editor yet. The plan, the
architecture and the phases are in [docs/PLAN.md](docs/PLAN.md) (in Norwegian).

## Run the stack

You need Docker with Compose v2.

```sh
cp docker/.env.example docker/.env
# Put a password in each of the three PASSWORD lines of docker/.env:  openssl rand -hex 32
docker compose -f docker/compose.yaml up -d --build
```

Then open <http://localhost:8080>.

| Address       | What it is                                                  |
| ------------- | ----------------------------------------------------------- |
| `/`           | the site                                                    |
| `/admin`      | the admin app                                               |
| `/setup`      | the first-run wizard; it redirects to `/admin/setup`        |
| `/api/health` | 200 when the API is up                                      |
| `/api/ready`  | 200 when the API can reach the database, 503 when it cannot |

Compose stops with a clear message when a password is empty; there are no default passwords. The migrations run in
their own step (`migrate`) before the API and the worker start.

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
- **Update.** `docker compose -f docker/compose.yaml pull && docker compose -f docker/compose.yaml up -d` once images are
  published. Nothing is published yet, so for now update with `git pull` and `up -d --build`.
- **Valkey** (cache) is optional and not used yet: `COMPOSE_PROFILES=valkey` in `docker/.env`.
- **The CLI** runs in the API container: `docker compose -f docker/compose.yaml exec api toa --version`.
- **Stop.** `docker compose -f docker/compose.yaml down` (add `-v` to delete the database volume as well).

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
and only to your proxy: not `private_ranges` and not a range such as `10.0.0.0/8`, which would include every container
and LAN host that can reach the port. Empty is safe but then every request appears to come from the proxy.

The `edge` network has a fixed subnet (`TOASCRIBE_EDGE_SUBNET`, default `10.231.97.0/24`) so that the address to trust
is known. What the stack sees (measured with Caddy 2.11.7 and Docker 29):

| Your proxy runs                                                           | Point it at                     | The stack sees it as                 | `TOASCRIBE_TRUSTED_PROXY`                    |
| ------------------------------------------------------------------------- | ------------------------------- | ------------------------------------ | -------------------------------------------- |
| on this host, outside Docker (or with host networking)                    | `http://127.0.0.1:8080`         | `10.231.97.1`, the gateway of `edge` | `10.231.97.1`                                |
| in a container on this host                                               | `http://toascribe-proxy-1:8080` | its own address on `edge`            | `10.231.97.0/24`, or its fixed address on it |
| on another machine (set `TOASCRIBE_HTTP_BIND` to an address of this host) | that address and the port       | its own address                      | that address                                 |

For a proxy in a container, join the network `toascribe_edge` (in the proxy's own compose file:
`networks: { toascribe_edge: { external: true } }`). In the first case every process on this host that connects to
`127.0.0.1:8080` appears as `10.231.97.1`, so trusting it trusts the whole host; that is fine on a host you control.
To check which address the stack sees, send one request and read `remote_ip` in
`docker compose -f docker/compose.yaml logs proxy --tail 1`. If Docker answers "Pool overlaps" for the `edge` subnet,
set `TOASCRIBE_EDGE_SUBNET` to a free range and trust that range instead.

## Develop

You need Node 24 (see `.node-version`, at least 24.12), Docker, and pnpm. pnpm's version is pinned by `packageManager`
in `package.json`; `corepack enable` picks it up.

```sh
pnpm install
pnpm exec lefthook install   # git hooks: commit message check, lint and typecheck before commit, protect main
```

**The checks.** One command runs format check, lint, typecheck, test and build for every workspace package and for the
root files (`eslint`, `tsc` and the `root` Vitest project):

```sh
pnpm check
```

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

**The apps in dev mode.** They need a database that has the toascribe roles, which the postgres image of the stack
creates on its first start:

```sh
docker build -f docker/postgres/Dockerfile -t toascribe-postgres-dev .
owner="$(openssl rand -hex 16)"; app="$(openssl rand -hex 16)"
docker run -d --name toascribe-dev-db -e POSTGRES_DB=toascribe -e POSTGRES_PASSWORD="$(openssl rand -hex 16)" \
  -e POSTGRES_OWNER_PASSWORD="$owner" -e POSTGRES_APP_PASSWORD="$app" \
  -p 127.0.0.1:5432:5432 -v toascribe_dev_data:/var/lib/postgresql toascribe-postgres-dev

# .env in the repo root is read by the api and worker dev scripts (and is git-ignored)
printf 'DATABASE_URL=postgres://toascribe_app:%s@127.0.0.1:5432/toascribe\nPUBLIC_ORIGIN=http://localhost:3000\n' "$app" > .env
MIGRATION_DATABASE_URL="postgres://toascribe_owner:$owner@127.0.0.1:5432/toascribe" pnpm --filter @toascribe/db migrate

pnpm --filter @toascribe/api dev     # http://localhost:3001/api/health
pnpm --filter @toascribe/worker dev  # the job queue worker
pnpm --filter @toascribe/site dev    # http://localhost:3000, /api is proxied to the API
pnpm --filter @toascribe/admin dev   # http://localhost:3002/admin
```

## Layout

| Folder                         | What is in it                                                              |
| ------------------------------ | -------------------------------------------------------------------------- |
| `apps/api`, `apps/worker`      | the Hono API and the pg-boss worker (one image, two commands)              |
| `apps/site`, `apps/admin`      | the two Nuxt apps                                                          |
| `packages/db`                  | Drizzle client, migrations and the migration runner                        |
| `packages/shared`              | Zod schemas and types shared by the API and the apps                       |
| `packages/nuxt-base`           | the Nuxt layer both apps share (Nuxt UI, i18n, API layer, config)          |
| `packages/sdk`, `ui`, `blocks` | placeholders for the plugin and theme SDK, shared UI and block definitions |
| `themes/default`               | the default theme, a Nuxt layer                                            |
| `cli`                          | the `toa` command                                                          |
| `docker`                       | Dockerfiles, `compose.yaml`, `.env.example`, the Caddyfile, database roles |

## More

[CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [CHANGELOG.md](CHANGELOG.md) · [AGENTS.md](AGENTS.md) ·
[LICENSE](LICENSE) (MIT)
