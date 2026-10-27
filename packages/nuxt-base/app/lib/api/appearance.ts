import {
  GlobalSetChoicesResponse,
  GlobalSetDetail,
  GlobalSetListResponse,
  MenuDetail,
  MenuListResponse,
  MenuLocationsResponse,
} from '@toascribe/shared'
import type { CreateGlobalSetRequest, MenuItem, MenuLocations } from '@toascribe/shared'

import type { ApiCall } from './client.ts'

const V1 = '/v1'

/** «Utseende → Menyer» and «Utseende → Globale sett» (M1.5), `edit_theme_options`. Every answer is parsed with the shared schema. */
export function createAppearanceApi(api: ApiCall) {
  const menu = (id: string) => `${V1}/menus/${encodeURIComponent(id)}`
  const set = (id: string) => `${V1}/global-sets/${encodeURIComponent(id)}`
  return {
    menus: async () => MenuListResponse.parse(await api(`${V1}/menus`)),
    createMenu: async (name: string) => MenuDetail.parse(await api(`${V1}/menus`, { method: 'POST', body: { name } })),
    menu: async (id: string) => MenuDetail.parse(await api(menu(id))),
    saveMenu: async (id: string, changes: { name?: string; items?: readonly MenuItem[] }) =>
      MenuDetail.parse(
        await api(menu(id), {
          method: 'PATCH',
          body: {
            ...(changes.name === undefined ? {} : { name: changes.name }),
            ...(changes.items === undefined
              ? {}
              : { items: [...changes.items] as unknown as Record<string, unknown>[] }),
          },
        }),
      ),
    deleteMenu: async (id: string) => {
      await api(menu(id), { method: 'DELETE' })
    },
    locations: async () => MenuLocationsResponse.parse(await api(`${V1}/menu-locations`)),
    saveLocations: async (locations: MenuLocations) =>
      MenuLocationsResponse.parse(await api(`${V1}/menu-locations`, { method: 'PUT', body: { locations } })),
    globalSets: async () => GlobalSetListResponse.parse(await api(`${V1}/global-sets`)),
    /** The sets to choose from in the «Globalt sett» block (slug and name), for anyone who edits content. */
    globalSetChoices: async () => GlobalSetChoicesResponse.parse(await api(`${V1}/global-sets/choices`)),
    createGlobalSet: async (request: CreateGlobalSetRequest) =>
      GlobalSetDetail.parse(await api(`${V1}/global-sets`, { method: 'POST', body: request })),
    globalSet: async (id: string) => GlobalSetDetail.parse(await api(set(id))),
    saveGlobalSet: async (id: string, changes: { name?: string; blocks?: readonly unknown[] }) =>
      GlobalSetDetail.parse(
        await api(set(id), {
          method: 'PATCH',
          body: {
            ...(changes.name === undefined ? {} : { name: changes.name }),
            ...(changes.blocks === undefined ? {} : { blocks: [...changes.blocks] as Record<string, unknown>[] }),
          },
        }),
      ),
    deleteGlobalSet: async (id: string) => {
      await api(set(id), { method: 'DELETE' })
    },
  }
}

export type AppearanceApi = ReturnType<typeof createAppearanceApi>

/** Call synchronously in setup, a plugin or middleware: it needs the Nuxt context. */
export function useAppearanceApi(): AppearanceApi {
  const { $api } = useNuxtApp()
  return createAppearanceApi($api)
}
