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

- **Behind Traefik or nginx.** Only the proxy container publishes a port (`TOASCRIBE_HTTP_PORT`, default 8080), and it has
  no TLS. Point your external proxy at that port and set `PUBLIC_ORIGIN` to the public address. The proxy trusts
  `X-Forwarded-*` headers from private network ranges (`TOASCRIBE_TRUSTED_PROXIES`).
- **Update.** `docker compose -f docker/compose.yaml pull && docker compose -f docker/compose.yaml up -d` once images are
  published. Nothing is published yet, so for now update with `git pull` and `up -d --build`.
- **Valkey** (cache) is optional and not used yet: `COMPOSE_PROFILES=valkey` in `docker/.env`.
- **The CLI** runs in the API container: `docker compose -f docker/compose.yaml exec api toa --version`.
- **Stop.** `docker compose -f docker/compose.yaml down` (add `-v` to delete the database volume as well).

## Develop

You need Node 24 (see `.node-version`, at least 24.12), Docker, and pnpm. pnpm's version is pinned by `packageManager`
in `package.json`; `corepack enable` picks it up.

```sh
pnpm install
pnpm exec lefthook install   # git hooks: commit message check, lint and typecheck before commit, protect main
```

**The checks** (every workspace package has all four scripts, so these run everywhere):

```sh
pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm -r build
pnpm format:check
```

**A database for the tests.** The database tests need a superuser URL on a disposable PostgreSQL 18; they create and
drop their own databases and roles on it. Without `TEST_DATABASE_URL` they skip and say so.

```sh
password="$(openssl rand -hex 16)"
docker run -d --rm --name toascribe-test-db -e POSTGRES_PASSWORD="$password" -p 127.0.0.1:55432:5432 postgres:18-alpine
export TEST_DATABASE_URL="postgres://postgres:$password@127.0.0.1:55432/postgres"
pnpm -r test
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
| `packages/sdk`, `ui`, `blocks` | placeholders for the plugin and theme SDK, shared UI and block definitions |
| `themes/default`               | the default theme, a Nuxt layer                                            |
| `cli`                          | the `toa` command                                                          |
| `docker`                       | Dockerfiles, `compose.yaml`, `.env.example`, the Caddyfile, database roles |

## More

[CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [CHANGELOG.md](CHANGELOG.md) · [AGENTS.md](AGENTS.md) ·
[LICENSE](LICENSE) (MIT)
