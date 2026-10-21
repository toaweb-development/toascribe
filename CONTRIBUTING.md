# Contributing

Thanks for helping. This file is the short version; [AGENTS.md](AGENTS.md) has the rules the code follows in more detail,
and [README.md](README.md) has the commands to run the stack and the checks.

## Set up

```sh
pnpm install
pnpm exec lefthook install
```

`lefthook install` sets up the git hooks, once per clone:

- `commit-msg` checks the commit message (Conventional Commits, below);
- `pre-commit` runs `pnpm lint` and then `pnpm typecheck` (one after the other, not in parallel);
- `pre-push` refuses a force push to `main`, deleting `main`, and moving or deleting a `v*` tag.

## Commits

Every commit message follows [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>
```

- Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `style`, `perf`, `test`, `ci`, `revert`.
- Description: English, lower case, imperative ("add", not "added"), no full stop, about 72 characters at most.
- A breaking change gets `!` after the type and a `BREAKING CHANGE:` footer.

## Branches

Work is trunk-based: branch from `main`, keep the branch short-lived, one branch for one task, and merge back with a
merge commit (`--no-ff`). Name branches `<type>/<short-description>` in lower case with hyphens, for example
`feat/post-routing` or `fix/ready-timeout`. Never commit to `main` directly and never force-push it.

## The four scripts

Every workspace package defines `lint`, `typecheck`, `test` and `build`, because `pnpm check` runs
`pnpm -r lint`, `pnpm -r typecheck`, `pnpm -r test` and `pnpm -r build` without `--if-present`. A package with nothing to
test uses `vitest run --passWithNoTests`; one with nothing to lint or build uses an `echo` that says why. A new package
must have all four before it is merged.

Dependency versions live once, in the `catalog:` of `pnpm-workspace.yaml`; a package writes `catalog:` (or
`workspace:*` for a workspace package) and never a version of its own.

## Tests

Tests use Vitest and live in a `test/` folder next to `src/` in each package. The database tests need a disposable
PostgreSQL 18: see "A database for the tests" in the README, and set `TEST_DATABASE_URL`. Without it they skip and say
so, so a green run without the variable has not run them. A bug fix comes with a test that fails without the fix.

Before you push, run `pnpm check` (format check, lint, typecheck, test and build, for every package and the root files),
and `docker compose -f docker/compose.yaml up -d --build` if you touched
anything under `docker/`. CI runs the same checks, builds every image, scans them and starts the stack.

## Versions and the CHANGELOG

A change to what is shipped (`apps/`, `packages/`, `cli/`, `themes/`, `docker/`, `package.json`, `pnpm-lock.yaml`,
`pnpm-workspace.yaml`) needs a new version in the same branch, or the Version check fails. Tests are not shipped: a change
only to tests (`test/` folders, `*.test.ts`), Vitest configs or ESLint configs needs no bump. The exact list is
`NOT_RELEASED` in `.github/workflows/version.yml`.

1. Bump `version` in the root `package.json` and in every workspace `package.json` (a test checks they match), and the
   default of `TOASCRIBE_VERSION` in `docker/compose.yaml`, `docker/compose.build.yaml` and `docker/.env.example` (a test checks that too).
2. Add `## [X.Y.Z] - YYYY-MM-DD` to `CHANGELOG.md`, written for people: what changes for them, not which commit.
   `git cliff --unreleased --bump --strip header` gives a draft.

When the change reaches `main`, a workflow tags `vX.Y.Z` and publishes the GitHub Release. Do not tag by hand.

## Security

Do not report a vulnerability in an issue; see [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
