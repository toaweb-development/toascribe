# Backlog

Open items that are not tied to a milestone yet. One item per line, with where it came from. When an item is done, remove its
line in the same commit; when it becomes a milestone task, move it into `docs/PLAN.md`.

## Releases and supply chain

- Go back to the official Caddy and postgres images (remove the rebuilt Caddy and gosu stages, pin the official images by tag and digest, drop the entry in AGENTS.md «Known deviations») when they pass `trivy image --severity CRITICAL,HIGH --ignore-unfixed` on their own. — issue #5
- `pnpm audit` reports a Low, GHSA-g7r4-m6w7-qqqr (esbuild via `@nuxt/ui > @nuxt/fonts > fontless`); it affects only the dev server on Windows. — issue #6
- Review the two documented audit exceptions (GHSA-86w9-cpqp-85rv node-forge, GHSA-vfj7-8cjw-p6xm braces) by 2026-11-20, the date in `pnpm-workspace.yaml`. — AGENTS.md «Known deviations»
- The `pre-commit` hook runs `pnpm lint && pnpm typecheck`; GIT_STANDARD says pre-commit stays light now that `pre-push` runs `pnpm check`. Decide whether to drop it. — local-first change (0.6.0)
- `release.yml` has not run yet in its new shape (build, publish, release); the first tag `v0.6.0` is its first run. — local-first change (0.6.0)

## Code and structure

- Media storage on S3 (or a compatible service) as a second implementation of the storage interface; M1.2 has the local volume only. — M1.2 brief
- A static front page split by page breaks has no second page: `/2/` is read as a slug and gives 404 (WordPress: `/2/` or `/?page=2`). Item pages and archives are paged. — M1.4

- `apps/admin` has its own copy of `globals.css` and `tokens/colors.css`, identical to `themes/default`; decide whether they should be shared, for example in `packages/nuxt-base`. — issue #6
- `nuxt dev` prints a note that Vite found `zod` at runtime (via the alias to `shared/src`); harmless, costs at most one reload. — issue #6
- The placeholder tests in `packages/sdk` and `packages/ui` stay until those packages get content. — issue #6
- Security headers and CSP: the stack now sets its own (`nuxt-security` in `packages/nuxt-base`, since 0.3.0); check that the open question in issue #6 is answered and close it. — issue #6

## Before phase 1 (from the M0.6 decision note)

- Decide the rich-text format: JSON nodes (recommended) or HTML strings with a sanitiser. — docs/decisions/0001-editor-model.md
- Decide where `Edit.vue` and `View.vue` live, and how a theme overrides the view of a core block. — docs/decisions/0001-editor-model.md
- Decide whether the admin CSP allows `https:` images in the editor (M1.3), or images from an address always go through the media library first. — docs/decisions/0001-editor-model.md
- Decide which core blocks M1.3 has (list, heading, quote, code, image, columns and group suggested; the rest later). — docs/decisions/0001-editor-model.md
- Decide the content for M1.8: by hand, or the WXR import (in whole or in part) moved forward from phase 2. — docs/decisions/0001-editor-model.md
- Decide the keyboard move into and out of columns: keep the prototype's behaviour, or do as Gutenberg (same parent only, plus «move to»). — docs/decisions/0001-editor-model.md
