import { SiteHealthInfoResponse, SiteHealthStatusResponse, UpdatesResponse } from '@toascribe/shared'
import type { UpdateUpdatesSettingsRequest } from '@toascribe/shared'

import type { ApiCall } from './client.ts'

/** «Oppdateringer» (`update_core`) and «Nettstedshelse → Info» (`manage_options`), M1.7. Every answer is parsed with the shared schema. */
export function createSiteToolsApi(api: ApiCall) {
  return {
    updates: async () => UpdatesResponse.parse(await api('/v1/updates')),
    updateUpdates: async (request: UpdateUpdatesSettingsRequest) =>
      UpdatesResponse.parse(await api('/v1/updates/settings', { method: 'PATCH', body: request })),
    healthInfo: async () => SiteHealthInfoResponse.parse(await api('/v1/site-health/info')),
    healthStatus: async () => SiteHealthStatusResponse.parse(await api('/v1/site-health/status')),
  }
}

export type SiteToolsApi = ReturnType<typeof createSiteToolsApi>

/** Call synchronously in setup, a plugin or middleware: it needs the Nuxt context. */
export function useSiteToolsApi(): SiteToolsApi {
  const { $api } = useNuxtApp()
  return createSiteToolsApi($api)
}
