# End-to-end tests of the admin

Playwright tests that drive the real stack in a browser: the proxy, the admin, the API, the worker and the database, with
Mailpit catching the mail. They cover the sign-in screens (M0.3): login and logout, lost password through a mailed link, the
second factor (set-up on the screen, a code from the app, a recovery code), registration, e-mail confirmation, the site name
from the settings, the wait after too many wrong tries, the headers and the CSP of the admin and of the public site (`/`), and
an axe-core check (WCAG 2.2 AA rule sets) on every screen. The setup wizard (M0.4) is tested from an empty database to a signed-in
administrator (`wizard.spec.ts`). The admin shell, the profile and the users list (M0.5) have `shell.spec.ts`, `profile.spec.ts` and
`users.spec.ts`. The block editor prototype (M0.6) has `editor-prototype.spec.ts` (columns, an image, formatting, a move, undo
and redo, save, reload and the server-rendered preview) and `editor-performance.spec.ts` (200 text blocks; it prints its
numbers, and `E2E_CPU_THROTTLE=4` slows the browser's CPU four times). Each test runs at 375 px and at 1280 px.

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
More variables, for a host where the defaults are taken:

- `E2E_STATE_DIR`: where `stack.sh` keeps the env file (default `$TMPDIR/<project>`).
- `E2E_EDGE_SUBNET`: the subnet of the stack's `edge` network (default compose.yaml's `10.231.97.0/24`).
- `E2E_VERSION`: the image tag the stack builds and runs (default `0.3.0-e2e`).
- `E2E_WIZARD_PROJECT`, `E2E_WIZARD_HTTP_PORT`, `E2E_WIZARD_MAILPIT_PORT`, `E2E_WIZARD_SUBNET`: the same for the wizard's own
  stack (defaults `toascribe-e2e-setup`, 18081, 18026, `10.231.98.0/24`).
- `E2E_BASE_URL`, `E2E_MAILPIT_URL`, `E2E_ENV_FILE`: what `stack.sh env` prints; the tests read them.

## What to know

- **The wizard has a stack of its own.** An installed site cannot be installed twice, so `wizard.spec.ts` takes a second stack
  (project `toascribe-e2e-setup`, ports 18081 and 18026, its own subnet for the `edge` network, its own env file) down with its
  volumes and starts it again before each width, through `stack.sh`. Start the main stack first (`stack.sh up`) as before; the
  wizard's is made by the test and left running afterwards. Remove it with
  `E2E_PROJECT=toascribe-e2e-setup E2E_HTTP_PORT=18081 E2E_MAILPIT_PORT=18026 apps/admin/e2e/stack.sh down`.
- **The other specs need an installed site,** because until it is installed every page goes to the wizard. The global setup
  installs the main stack through the CLI (`toa core install --skip-email`) when it is not installed yet.

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
