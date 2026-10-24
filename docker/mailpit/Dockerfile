# syntax=docker/dockerfile:1.7
# The Mailpit image of the development-only `mailpit` profile: the official image with its binary rebuilt.
# Build context: the repo root (nothing is copied from it).   docker build -f docker/mailpit/Dockerfile .

# Mailpit v1.31.6, rebuilt with Go 1.27.3. The official v1.31.6 image is built with Go 1.27.2, and the image scan
# (Trivy, CRITICAL and HIGH with a known fix) fails on one finding in that binary (CVE-2026-111943, crypto/x509,
# fixed in Go 1.27.3). Same Mailpit source, same build steps as upstream's Dockerfile (the frontend bundle is built
# with npm, then `go build`), only the Go toolchain differs. Remove this stage, and use the official image as it is,
# once a Mailpit release is built with Go 1.27.3 or later.
FROM golang:1.27.3-alpine3.24@sha256:f2c872bcee949b7be9c490efd02b48a8a2fbf947cdf533f1c58525ec9d8170fd AS build
RUN apk add --no-cache git npm
# The commit behind the tag v1.31.6, not the tag: a tag can be moved.
ARG MAILPIT_VERSION=v1.31.6
ARG MAILPIT_COMMIT=a028b01f4a24b4b36bdad95b8e09e070ebf2bad4
WORKDIR /src
RUN git init -q . \
 && git fetch -q --depth 1 https://github.com/axllent/mailpit.git "${MAILPIT_COMMIT}" \
 && git checkout -q FETCH_HEAD
RUN npm ci --no-audit --no-fund && npm run package
# -buildvcs=false, like upstream's build (no .git): with it Go records the commit as a pseudo-version (v0.0.0-2026...)
# of the module, and the scanner then reads that as a very old Mailpit and reports three advisories fixed in 1.30.
RUN CGO_ENABLED=0 go build -trimpath -buildvcs=false \
      -ldflags "-s -w -X github.com/axllent/mailpit/config.Version=${MAILPIT_VERSION}" -o /mailpit

# The official image, pinned by tag and digest (DOCKER_STANDARD rule 1): it has tzdata and the sendmail links.
# Only the binary is replaced. It runs as root by default; compose.yaml sets the user.
FROM axllent/mailpit:v1.31.6@sha256:23fe39e81bde596a918000b3135c0f85dc8bb4c9ea6be274b051143f3e300387
# apk upgrade: every build takes all security fixes Alpine has published since the base image was built, not only
# the one a scan found that day. The image scan before publishing is still the gate.
RUN apk upgrade --no-cache
COPY --from=build /mailpit /mailpit
