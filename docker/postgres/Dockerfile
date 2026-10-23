# syntax=docker/dockerfile:1.7
# The postgres image: the official image plus the toascribe role setup, so a user needs only compose.yaml and .env
# (no bind mount of files from the repo). The SQL stays in docker/postgres/init.sql, once.
# Build context: the repo root.   docker build -f docker/postgres/Dockerfile .

# gosu, rebuilt with a current Go toolchain. The official image ships gosu 1.19 built with Go 1.24.6, and the image scan
# (Trivy, CRITICAL and HIGH with a known fix) fails on 25 Go standard-library findings in that one binary. gosu only
# drops root privileges at start-up, so none of them is reachable, but the scan gate has no per-binary exception.
# Same gosu version (1.19), pinned by its commit rather than the movable tag: Go turns the commit into a pseudo-version
# and checks it against the module proxy's checksum database. Remove this stage once the official
# image ships a gosu built with Go 1.26.9 or newer.
FROM golang:1.27.3-alpine3.24@sha256:f2c872bcee949b7be9c490efd02b48a8a2fbf947cdf533f1c58525ec9d8170fd AS gosu
RUN CGO_ENABLED=0 go install -trimpath -ldflags '-s -w' github.com/tianon/gosu@6456aaa0f3c854d199d0f037f068eb97515b7513

# Pinned by tag and digest (DOCKER_STANDARD rule 1, POSTGRESQL_STANDARD: PostgreSQL 18).
FROM postgres:18.6-alpine3.24@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873

COPY --from=gosu /go/bin/gosu /usr/local/bin/gosu

# 10-init.sh goes where the image runs it once, on an empty data directory. init.sql does NOT go there:
# the image would run it without the psql variables. 10-init.sh reads it from /etc/toascribe/postgres/.
# (The folder is made first: COPY --chmod would give a folder it creates the file's mode, here 0444 with no x bit.)
RUN mkdir -p /etc/toascribe/postgres
COPY --chmod=0555 docker/postgres/10-init.sh /docker-entrypoint-initdb.d/10-init.sh
COPY --chmod=0444 docker/postgres/init.sql /etc/toascribe/postgres/init.sql

# Refuses to start when a password is empty, before the data directory is made (entrypoint.sh says why), then runs the
# official entrypoint with the same arguments.
COPY --chmod=0555 docker/postgres/entrypoint.sh /usr/local/bin/toascribe-entrypoint.sh
ENTRYPOINT ["toascribe-entrypoint.sh"]
CMD ["postgres"]

# 127.0.0.1, not the socket: while the image runs the init scripts a temporary server listens on the socket only,
# so a socket check would report ready before the roles exist.
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD ["sh", "-c", "pg_isready -h 127.0.0.1 -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\""]
