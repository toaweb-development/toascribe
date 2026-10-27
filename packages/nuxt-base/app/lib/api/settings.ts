import {
  ConfirmAdminEmailResponse,
  GeneralSettingsResponse,
  PrivacySettingsResponse,
  ReadingSettingsResponse,
  WritingSettingsResponse,
} from '@toascribe/shared'
import type {
  UpdateGeneralSettingsRequest,
  UpdatePrivacySettingsRequest,
  UpdateReadingSettingsRequest,
  UpdateWritingSettingsRequest,
} from '@toascribe/shared'

import type { ApiCall } from './client.ts'

const BASE = '/v1/settings'

/** «Innstillinger» → Generelt, Skriving, Lesing and Personvern (M1.5), `manage_options`. Every answer is parsed with the shared schema. */
export function createSettingsApi(api: ApiCall) {
  return {
    general: async () => GeneralSettingsResponse.parse(await api(`${BASE}/general`)),
    updateGeneral: async (request: UpdateGeneralSettingsRequest) =>
      GeneralSettingsResponse.parse(await api(`${BASE}/general`, { method: 'PATCH', body: request })),
    /** The link sent to a new administrator address (K-192). */
    confirmAdminEmail: async (token: string) =>
      ConfirmAdminEmailResponse.parse(
        await api(`${BASE}/general/admin-email/confirm`, { method: 'POST', body: { token } }),
      ),
    writing: async () => WritingSettingsResponse.parse(await api(`${BASE}/writing`)),
    updateWriting: async (request: UpdateWritingSettingsRequest) =>
      WritingSettingsResponse.parse(await api(`${BASE}/writing`, { method: 'PATCH', body: request })),
    reading: async () => ReadingSettingsResponse.parse(await api(`${BASE}/reading`)),
    updateReading: async (request: UpdateReadingSettingsRequest) =>
      ReadingSettingsResponse.parse(await api(`${BASE}/reading`, { method: 'PATCH', body: request })),
    privacy: async () => PrivacySettingsResponse.parse(await api(`${BASE}/privacy`)),
    updatePrivacy: async (request: UpdatePrivacySettingsRequest) =>
      PrivacySettingsResponse.parse(await api(`${BASE}/privacy`, { method: 'PATCH', body: request })),
  }
}

export type SettingsApi = ReturnType<typeof createSettingsApi>

/** Call synchronously in setup, a plugin or middleware: it needs the Nuxt context. */
export function useSettingsApi(): SettingsApi {
  const { $api } = useNuxtApp()
  return createSettingsApi($api)
}
