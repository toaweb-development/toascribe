import {
  SETUP_TOKEN_HEADER,
  SetupCheckResponse,
  SetupEmailResponse,
  SetupEmailSkipResponse,
  SetupEmailTestResponse,
  SetupInstallResponse,
  SetupRecoveryKeyResponse,
  SetupSiteResponse,
  SetupStateResponse,
  SetupStatusResponse,
  SetupTokenVerifyResponse,
} from '@toascribe/shared'
import type { SetupEmail, SetupInstallRequest, SetupSite } from '@toascribe/shared'

import type { ApiCall } from './client.ts'

/** The versioned API: `apiBase` is `/api`, the setup endpoints are under `/api/v1/setup`. */
const SETUP = '/v1/setup'

/** How long the test e-mail may take: the api waits up to 30 s for the worker to hand the mail over. */
export const TEST_EMAIL_TIMEOUT_MS = 40_000

/**
 * The endpoints of the setup wizard (`/api/v1/setup/*`, M0.4). Every answer is parsed with the shared schema. Errors are
 * ApiRequestError. Everything but `status` needs the one-time setup token, sent in `X-Setup-Token` (never in the query string,
 * which the api's and the proxy's logs would keep); from the moment the site is installed all of them but `status` answer 404.
 * No CSRF token is used here: the setup token takes its place (the client treats these paths as public).
 */
export function createSetupApi(api: ApiCall) {
  const withToken = (token: string) => ({ [SETUP_TOKEN_HEADER]: token })

  return {
    /** Open to anyone: installed or not, and the first step that is not saved. */
    status: async () => SetupStatusResponse.parse(await api(`${SETUP}/status`)),
    /** What is saved so far, so a reload fills the forms again. */
    state: async (token: string) =>
      SetupStateResponse.parse(await api(`${SETUP}/state`, { headers: withToken(token) })),
    /** 200 when the token is the current one. */
    verifyToken: async (token: string) =>
      SetupTokenVerifyResponse.parse(await api(`${SETUP}/token/verify`, { method: 'POST', headers: withToken(token) })),
    /** The system check. The api compares `PUBLIC_ORIGIN` with the Origin or Referer this request carries. */
    check: async (token: string) =>
      SetupCheckResponse.parse(await api(`${SETUP}/check`, { headers: withToken(token) })),
    saveSite: async (token: string, site: SetupSite) =>
      SetupSiteResponse.parse(await api(`${SETUP}/site`, { method: 'PUT', body: site, headers: withToken(token) })),
    saveEmail: async (token: string, email: SetupEmail) =>
      SetupEmailResponse.parse(await api(`${SETUP}/email`, { method: 'PUT', body: email, headers: withToken(token) })),
    /** 200 whatever the outcome: `ok: false` carries a reason code. */
    testEmail: async (token: string, to: string) =>
      SetupEmailTestResponse.parse(
        await api(`${SETUP}/email/test`, {
          method: 'POST',
          body: { to },
          headers: withToken(token),
          timeout: TEST_EMAIL_TIMEOUT_MS,
        }),
      ),
    skipEmail: async (token: string) =>
      SetupEmailSkipResponse.parse(await api(`${SETUP}/email/skip`, { method: 'POST', headers: withToken(token) })),
    /** Makes a new recovery key; an earlier one stops working. */
    recoveryKey: async (token: string) =>
      SetupRecoveryKeyResponse.parse(await api(`${SETUP}/recovery-key`, { method: 'POST', headers: withToken(token) })),
    /** The last act: the administrator, the default content and the `installed` flag in one transaction; the session cookie is set. */
    install: async (token: string, body: SetupInstallRequest) =>
      SetupInstallResponse.parse(await api(`${SETUP}/install`, { method: 'POST', body, headers: withToken(token) })),
  }
}

export type SetupApi = ReturnType<typeof createSetupApi>

/** Call synchronously in setup, a plugin or middleware: it needs the Nuxt context. */
export function useSetupApi(): SetupApi {
  const { $api } = useNuxtApp()
  return createSetupApi($api)
}
