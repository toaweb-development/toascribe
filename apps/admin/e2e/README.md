# End-to-end tests of the admin

Playwright tests that drive the real stack in a browser: the proxy, the admin, the API, the worker and the database, with
Mailpit catching the mail. They cover the sign-in screens (M0.3): login and logout, lost password through a mailed link, the
second factor (set-up on the screen, a code from the app, a recovery code), registration, e-mail confirmation, the site name
from the settings, the wait after too many wrong tries, the headers and the CSP of the admin and of the public site (`/`), and
an axe-core check (WCAG 2.2 AA rule sets) on every screen. Each test runs at 375 px and at 1280 px.

They are not part of `pnpm check`: they need Docker and a running stack, and they take a few minutes.

## Why here

They sit in `apps/admin/e2e/` because the screens they test are the admin's. They reach the API, Mailpit and the database only
through the stack. A root `e2e/` folder would be a package of its own with all four scripts of the repo, for one dependency
set that only the admin uses.

## Run them

```sh
# 1. Start a stack of their own (own project name, ports, images and volumes; docker/.env is not touched).
apps/admin/e2e/stack.sh up

# 2. Run the tests. The defaults match stack.sh, so nothing needs exporting.
pnpm test:e2e                       # from the repo root
pnpm --filter @toascribe/admin test:e2e -- e2e/login.spec.ts --project=phone-375   # one file, one width

# 3. Remove the stack and its volumes.
apps/admin/e2e/stack.sh down
```

The first time, install the browser: `pnpm --filter @toascribe/admin exec playwright install chromium`.

`stack.sh up` writes fresh passwords and keys into a scratch env file under `$TMPDIR/toascribe-e2e/` (mode 600) and starts the
compose stack with the `mailpit` profile on `http://localhost:18080` (Mailpit on `:18025`). To use other names or ports, set
`E2E_PROJECT`, `E2E_HTTP_PORT` and `E2E_MAILPIT_PORT` for `stack.sh`, and export what `stack.sh env` prints before the tests.

## What to know

- **`localhost`, not `127.0.0.1`.** The session cookie is `__Host-toa_session`, `Secure`; Chromium accepts that on
  `http://localhost` only. Firefox does too, but the browsers are not installed by default, so the tests run in Chromium. WebKit does
  not allow it on plain http at all.
- **The tests share the stack,** so they run one after another. They make their own accounts with `toa user create` (through
  `docker compose exec api`), change three settings (`users_can_register`, `mfa_required_roles`, `blogname`; each is put back), and clear the
  failed-login counts between tests so one test's wrong passwords never make the next test wait.
- **The console must stay empty.** A test fails when the page writes an error or a warning, or when the browser reports a CSP
  violation. A test that makes the API refuse something on purpose (a wrong password is a 401, which a browser logs) says so with
  `allowFailedRequests()`.
- Results, traces and screenshots of failures go to `node_modules/.cache/playwright-results/`.
