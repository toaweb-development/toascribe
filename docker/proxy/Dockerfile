# syntax=docker/dockerfile:1.7
# The proxy image: Caddy with the toascribe Caddyfile baked in, so a user needs only compose.yaml and .env.
# Build context: the repo root.   docker build -f docker/proxy/Dockerfile .

# Caddy 2.11.7, rebuilt with a current Go toolchain and golang.org/x/net 0.60.0. The official 2.11.7 image is built with
# Go 1.26.8 and x/net 0.59.0, and the image scan (Trivy, CRITICAL and HIGH with a known fix) fails on four findings
# in that binary (CVE-2026-78667, -78669, -97031). Same Caddy source, no extra modules. Remove the replace flag
# and then this stage once the official image is rebuilt with fixed versions.
FROM caddy:2.11.7-builder-alpine@sha256:ef9b65adf9a224770c6d5f6d1ae1bf99bc3caaa78d8c4bae3ea949ee6984f301 AS build
# XCADDY_SETCAP=0: the builder image sets it to 1, which gives the binary cap_net_bind_service (see below).
RUN XCADDY_SETCAP=0 xcaddy build v2.11.7 --replace golang.org/x/net=golang.org/x/net@v0.60.0 --output /caddy

# Pinned by tag and digest (DOCKER_STANDARD rule 1). This digest is the rebuild on Alpine 3.23.7.
FROM caddy:2.11.7-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f

# Non-root user, and our caddy in place of the official one. The official binary has the file capability
# cap_net_bind_service (port 80). With `cap_drop: [ALL]` a file capability the container lacks makes exec fail
# ("operation not permitted"). We listen on 8080, so no capability is needed: the old file is removed and ours has none.
# apk upgrade: every build takes all security fixes Alpine has published since the base image was built, not only
# the one a scan found that day. The image scan before publishing is still the gate.
RUN apk upgrade --no-cache \
 && rm /usr/bin/caddy \
 && addgroup -S -g 10001 app \
 && adduser -S -u 10001 -G app -h /home/app -s /sbin/nologin app
COPY --from=build /caddy /usr/bin/caddy

COPY docker/proxy/Caddyfile /etc/caddy/Caddyfile

# Caddy writes small state files under XDG_DATA_HOME (/data) and XDG_CONFIG_HOME (/config).
# They are tmpfs mounts in compose.yaml, which keeps the root filesystem read-only.
USER 10001:10001
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8081/healthz"]

# Exec form, same command as the base image.
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
