import { AdminMenuResponse, GlanceResponse, NoticeListResponse } from '@toascribe/shared'

import type { ApiCall } from './client.ts'

/** The versioned API: `apiBase` is `/api`, the admin shell's endpoints are under `/api/v1`. */
const V1 = '/v1'

/**
 * The endpoints the admin shell and the dashboard read (M0.5): the menu, the «I korte trekk» counts and the notices.
 * Every answer is parsed with the shared schema, so a wrong body is an error and not a lie. Errors are ApiRequestError.
 * The CSRF token is not handled here: the client does it (client.ts).
 */
export function createAdminApi(api: ApiCall) {
  return {
    /** The menu the signed-in account may see, in the order to draw it. Labels are i18n keys. */
    menu: async () => AdminMenuResponse.parse(await api(`${V1}/admin/menu`)),
    /** The dashboard counts. A count the account may not see is missing from the answer. */
    glance: async () => GlanceResponse.parse(await api(`${V1}/dashboard/glance`)),
    /** The notices the account may see, most severe first. */
    notices: async () => NoticeListResponse.parse(await api(`${V1}/notices`)),
    /** «Avvis». 204 when it worked; 404 when the notice is gone, not dismissible or not the account's to see. */
    dismissNotice: async (key: string): Promise<void> => {
      await api(`${V1}/notices/${encodeURIComponent(key)}/dismiss`, { method: 'POST' })
    },
  }
}

export type AdminApi = ReturnType<typeof createAdminApi>

/** Call synchronously in setup, a plugin or middleware: it needs the Nuxt context. */
export function useAdminApi(): AdminApi {
  const { $api } = useNuxtApp()
  return createAdminApi($api)
}
