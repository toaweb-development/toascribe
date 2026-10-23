import { OpenAPIHono } from '@hono/zod-openapi'
import {
  ApiError,
  SetupCheckResponse,
  SetupEmail,
  SetupEmailResponse,
  SetupEmailSkipResponse,
  SetupEmailTestRequest,
  SetupEmailTestResponse,
  SetupInstallRequest,
  SetupInstallResponse,
  SetupRecoveryKeyResponse,
  SetupSite,
  SetupSiteResponse,
  SetupStateResponse,
  SetupStatusResponse,
  SetupTokenVerifyResponse,
} from '@toascribe/shared'

import { setSessionCookie } from '../lib/cookies.ts'
import { getClientIp } from '../lib/client-ip.ts'
import type { AppEnv } from '../lib/env.ts'
import { publicAccess, setupToken } from '../lib/policy.ts'
import { defineRoute } from '../middleware/policy.ts'
import type { Services } from '../services/index.ts'

const errorResponse = (description: string) => ({
  content: { 'application/json': { schema: ApiError } },
  description,
})

const TOKEN_NOTE =
  'Needs the one-time setup token in the X-Setup-Token header (never in the query string). From the moment the site is ' +
  'installed this route does not exist: 404, whatever is sent. A wrong token counts against the address; after a few the ' +
  'next try has to wait (429, Retry-After).'

const ORIGIN_NOTE =
  'A cross-site request is refused: the Origin must be this site, and the body must be application/json.'

const TOKEN_RESPONSES = {
  401: errorResponse('No setup token (`setup_token_required`) or a wrong one (`invalid_setup_token`)'),
  404: errorResponse('The site is installed'),
  429: errorResponse('Too many wrong tokens from this address; see Retry-After'),
}

const statusRoute = defineRoute({
  method: 'get',
  path: '/setup/status',
  tags: ['setup'],
  summary: 'Is the site installed',
  description:
    'Open to anyone: the Nuxt apps ask it on every page to send visitors to the wizard until the site is installed. It says ' +
    'whether the site is installed and, if not, the first step of the wizard that is not saved. Nothing else. Never cached.',
  policy: publicAccess(),
  responses: { 200: { content: { 'application/json': { schema: SetupStatusResponse } }, description: 'The status' } },
})

const stateRoute = defineRoute({
  method: 'get',
  path: '/setup/state',
  tags: ['setup'],
  summary: 'What the wizard has saved so far',
  description: `The saved site and e-mail steps, so a reload fills the forms again. The SMTP password is never returned, only whether one is set. ${TOKEN_NOTE}`,
  policy: setupToken(),
  responses: {
    200: { content: { 'application/json': { schema: SetupStateResponse } }, description: 'The saved steps' },
    ...TOKEN_RESPONSES,
  },
})

const verifyRoute = defineRoute({
  method: 'post',
  path: '/setup/token/verify',
  tags: ['setup'],
  summary: 'Check the setup token',
  description: `200 when the header holds the current setup token. ${TOKEN_NOTE} ${ORIGIN_NOTE}`,
  policy: setupToken(),
  responses: {
    200: { content: { 'application/json': { schema: SetupTokenVerifyResponse } }, description: 'The token is valid' },
    400: errorResponse('A cross-site request'),
    ...TOKEN_RESPONSES,
  },
})

const checkRoute = defineRoute({
  method: 'get',
  path: '/setup/check',
  tags: ['setup'],
  summary: 'The system check',
  description:
    'Database and migrations, the encryption and signing keys (present and valid, never their values), the proxy warning ' +
    'of TOASCRIBE_TRUSTED_PROXY, and PUBLIC_ORIGIN against the address the browser used (its Origin or Referer, or the ' +
    `forwarded host). ${TOKEN_NOTE}`,
  policy: setupToken(),
  responses: {
    200: { content: { 'application/json': { schema: SetupCheckResponse } }, description: 'The result of each check' },
    ...TOKEN_RESPONSES,
  },
})

const siteRoute = defineRoute({
  method: 'put',
  path: '/setup/site',
  tags: ['setup'],
  summary: 'Save the site step',
  description: `Language, title, time zone, the site's e-mail address and whether search engines may index it. Saved as settings at once. ${TOKEN_NOTE} ${ORIGIN_NOTE}`,
  policy: setupToken(),
  request: { body: { required: true, content: { 'application/json': { schema: SetupSite } } } },
  responses: {
    200: { content: { 'application/json': { schema: SetupSiteResponse } }, description: 'What was saved' },
    400: errorResponse('Invalid request, or a cross-site request'),
    409: errorResponse('The site was installed a moment ago (`already_installed`)'),
    ...TOKEN_RESPONSES,
  },
})

const emailRoute = defineRoute({
  method: 'put',
  path: '/setup/email',
  tags: ['setup'],
  summary: 'Save the e-mail step',
  description: `The SMTP server and the sender. The password is encrypted with the site key before it is stored and is never returned (\`smtpPasswordSet\` says whether one is stored); left out, the stored one is kept. ${TOKEN_NOTE} ${ORIGIN_NOTE}`,
  policy: setupToken(),
  request: { body: { required: true, content: { 'application/json': { schema: SetupEmail } } } },
  responses: {
    200: { content: { 'application/json': { schema: SetupEmailResponse } }, description: 'What was saved' },
    400: errorResponse('Invalid request, or a cross-site request'),
    409: errorResponse('The site was installed a moment ago (`already_installed`)'),
    ...TOKEN_RESPONSES,
  },
})

const emailTestRoute = defineRoute({
  method: 'post',
  path: '/setup/email/test',
  tags: ['setup'],
  summary: 'Send a test e-mail',
  description:
    'Queues a test mail to the address with the saved SMTP settings and waits (up to 30 seconds) for the worker. `ok` is true ' +
    'only when the job completed. Otherwise `error` is a code (`send_failed`, `mail_config`, `timeout`, `queue_unavailable`, ' +
    `\`throttled\`), never the text of the SMTP server's answer. ${TOKEN_NOTE} ${ORIGIN_NOTE}`,
  policy: setupToken(),
  request: { body: { required: true, content: { 'application/json': { schema: SetupEmailTestRequest } } } },
  responses: {
    200: {
      content: { 'application/json': { schema: SetupEmailTestResponse } },
      description: 'The outcome of the test',
    },
    400: errorResponse('Invalid request, or a cross-site request'),
    ...TOKEN_RESPONSES,
  },
})

const emailSkipRoute = defineRoute({
  method: 'post',
  path: '/setup/email/skip',
  tags: ['setup'],
  summary: 'Skip the e-mail step',
  description: `Stores a notice that the dashboard shows later («e-post ble hoppet over»). ${TOKEN_NOTE} ${ORIGIN_NOTE}`,
  policy: setupToken(),
  responses: {
    200: { content: { 'application/json': { schema: SetupEmailSkipResponse } }, description: 'The step is skipped' },
    400: errorResponse('A cross-site request'),
    409: errorResponse('The site was installed a moment ago (`already_installed`)'),
    ...TOKEN_RESPONSES,
  },
})

const recoveryKeyRoute = defineRoute({
  method: 'post',
  path: '/setup/recovery-key',
  tags: ['setup'],
  summary: 'Make a recovery key',
  description:
    'Makes the recovery key for backups and returns it. It is shown once and never stored; only a verifier is. Asking again ' +
    `makes another and the earlier one stops working. The install must send the key back. ${TOKEN_NOTE} ${ORIGIN_NOTE}`,
  policy: setupToken(),
  responses: {
    200: { content: { 'application/json': { schema: SetupRecoveryKeyResponse } }, description: 'The new key' },
    400: errorResponse('A cross-site request'),
    409: errorResponse('The site was installed a moment ago (`already_installed`)'),
    ...TOKEN_RESPONSES,
  },
})

const installRoute = defineRoute({
  method: 'post',
  path: '/setup/install',
  tags: ['setup'],
  summary: 'Install the site',
  description:
    'The last act. In one transaction: creates the first administrator, stores the recovery key verifier, makes the default ' +
    'content, and sets the installed flag; the setup token is deleted. Two at once: one wins, the other gets 409. Needs `confirmed: true` ' +
    '(the person has saved the recovery key) and the key itself. Signs the new administrator in: the response sets the ' +
    `session cookie and has the same body as a login. ${TOKEN_NOTE} ${ORIGIN_NOTE}`,
  policy: setupToken(),
  request: { body: { required: true, content: { 'application/json': { schema: SetupInstallRequest } } } },
  responses: {
    200: { content: { 'application/json': { schema: SetupInstallResponse } }, description: 'Installed' },
    400: errorResponse(
      'Invalid request (`confirmed` must be true), a password the site refuses because it is the username or the e-mail address (`weak_password`), a cross-site request, or a recovery key that is not the one made last (`recovery_key_mismatch`)',
    ),
    409: errorResponse(
      'Already installed (`already_installed`), a step is not saved (`step_missing`), the username or e-mail address is taken (`username_taken`, `email_taken`)',
    ),
    ...TOKEN_RESPONSES,
  },
})

/** Routes under /api/v1/setup. */
export function createSetupApp(services: Services) {
  const { install } = services
  return new OpenAPIHono<AppEnv>()
    .openapi(statusRoute, async (c) => c.json(await install.status(), 200))
    .openapi(stateRoute, async (c) => c.json(await install.state(), 200))
    .openapi(verifyRoute, async (c) => {
      const { nextStep } = await install.status()
      // After the guard the site is not installed, so there is a step. `check` is where a new wizard starts.
      return c.json({ valid: true as const, nextStep: nextStep ?? 'check' }, 200)
    })
    .openapi(checkRoute, async (c) =>
      c.json(
        await install.systemCheck({
          origin: c.req.header('origin'),
          referer: c.req.header('referer'),
          forwardedProto: c.req.header('x-forwarded-proto'),
          forwardedHost: c.req.header('x-forwarded-host'),
          host: c.req.header('host'),
        }),
        200,
      ),
    )
    .openapi(siteRoute, async (c) => {
      const site = await install.saveSite(c.req.valid('json'))
      return c.json({ site, nextStep: (await install.status()).nextStep ?? 'email' }, 200)
    })
    .openapi(emailRoute, async (c) => {
      const email = await install.saveEmail(c.req.valid('json'))
      return c.json({ email, nextStep: (await install.status()).nextStep ?? 'admin' }, 200)
    })
    .openapi(emailTestRoute, async (c) => c.json(await install.testEmail(c.req.valid('json').to), 200))
    .openapi(emailSkipRoute, async (c) => {
      await install.skipEmail()
      return c.json({ skipped: true as const, nextStep: (await install.status()).nextStep ?? 'admin' }, 200)
    })
    .openapi(recoveryKeyRoute, async (c) => c.json({ recoveryKey: await install.generateRecoveryKey() }, 200))
    .openapi(installRoute, async (c) => {
      const installed = await services.setup.install(c.req.valid('json'), {
        ip: getClientIp(c),
        requestId: c.get('requestId'),
        userAgent: c.req.header('user-agent') ?? null,
      })
      if (installed.issued !== null) {
        setSessionCookie(c, installed.issued.token, installed.issued.cookieMaxAgeSeconds)
      }
      return c.json({ installed: true as const, login: installed.login }, 200)
    })
}
