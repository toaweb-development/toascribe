import {
  MediaDetail,
  MediaFolderListResponse,
  MediaItem,
  MediaListResponse,
  MediaRegenerateResponse,
  MediaSettingsResponse,
} from '@toascribe/shared'
import type {
  CreateMediaFolderRequest,
  MediaEditOperation,
  MediaFromUrlRequest,
  MediaListQueryInput,
  UpdateMediaFolderRequest,
  UpdateMediaRequest,
  UpdateMediaSettingsRequest,
} from '@toascribe/shared'

import type { ApiCall } from './client.ts'

const V1 = '/v1'

/** The query string of `GET /media`: only what is set, in a fixed order. */
export function mediaQueryString(query: MediaListQueryInput): string {
  const params = new URLSearchParams()
  if (query.search !== undefined && query.search.trim() !== '') params.set('search', query.search.trim())
  if (query.group !== undefined) params.set('group', query.group)
  if (query.month !== undefined) params.set('month', query.month)
  if (query.folder !== undefined) params.set('folder', query.folder)
  if (query.mine !== undefined) params.set('mine', query.mine)
  if (query.ids !== undefined) params.set('ids', query.ids)
  if (query.orderby !== undefined) params.set('orderby', query.orderby)
  if (query.order !== undefined) params.set('order', query.order)
  if (query.page !== undefined) params.set('page', String(query.page))
  if (query.per_page !== undefined) params.set('per_page', String(query.per_page))
  return params.toString()
}

/**
 * The media library (M1.2). `upload_files` for the library; the file's own rights are checked by the api. An upload with progress is
 * in the admin (it needs XMLHttpRequest for the progress); `upload` here sends a file without it (a replacement, a test).
 */
export function createMediaApi(api: ApiCall) {
  const item = (id: string) => `${V1}/media/${encodeURIComponent(id)}`
  return {
    list: async (query: MediaListQueryInput = {}) => {
      const search = mediaQueryString(query)
      return MediaListResponse.parse(await api(search === '' ? `${V1}/media` : `${V1}/media?${search}`))
    },
    get: async (id: string) => MediaDetail.parse(await api(item(id))),
    upload: async (file: File, fields: Record<string, string> = {}) => {
      const form = new FormData()
      form.append('file', file)
      for (const [key, value] of Object.entries(fields)) form.append(key, value)
      return MediaItem.parse(await api(`${V1}/media`, { method: 'POST', body: form }))
    },
    fromUrl: async (request: MediaFromUrlRequest) =>
      MediaItem.parse(await api(`${V1}/media/from-url`, { method: 'POST', body: request })),
    update: async (id: string, request: UpdateMediaRequest) =>
      MediaItem.parse(await api(item(id), { method: 'PATCH', body: request })),
    remove: async (id: string) => {
      await api(item(id), { method: 'DELETE' })
    },
    replace: async (id: string, file: File) => {
      const form = new FormData()
      form.append('file', file)
      return MediaItem.parse(await api(`${item(id)}/replace`, { method: 'POST', body: form }))
    },
    edit: async (id: string, operations: MediaEditOperation[]) =>
      MediaItem.parse(await api(`${item(id)}/edit`, { method: 'POST', body: { operations } })),
    regenerate: async (ids?: string[]) =>
      MediaRegenerateResponse.parse(
        await api(`${V1}/media/regenerate`, { method: 'POST', body: ids === undefined ? {} : { ids } }),
      ),
    folders: async () => MediaFolderListResponse.parse(await api(`${V1}/media-folders`)),
    createFolder: async (request: CreateMediaFolderRequest) =>
      MediaFolderListResponse.parse(await api(`${V1}/media-folders`, { method: 'POST', body: request })),
    updateFolder: async (id: string, request: UpdateMediaFolderRequest) =>
      MediaFolderListResponse.parse(
        await api(`${V1}/media-folders/${encodeURIComponent(id)}`, { method: 'PATCH', body: request }),
      ),
    removeFolder: async (id: string) => {
      await api(`${V1}/media-folders/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },
    settings: async () => MediaSettingsResponse.parse(await api(`${V1}/settings/media`)),
    updateSettings: async (request: UpdateMediaSettingsRequest) =>
      MediaSettingsResponse.parse(await api(`${V1}/settings/media`, { method: 'PATCH', body: request })),
  }
}

export type MediaApi = ReturnType<typeof createMediaApi>

/** Call synchronously in setup, a plugin or middleware: it needs the Nuxt context. */
export function useMediaApi(): MediaApi {
  const { $api } = useNuxtApp()
  return createMediaApi($api)
}
