import { PrototypeDocument, PrototypeUploadResponse } from '@toascribe/shared'

import type { ApiCall } from './client.ts'

const BASE = '/v1/prototype/editor'

/**
 * PROTOTYPE (M0.6): the editor prototype's draft and image uploads. `get` and `save` need `edit_posts`, `upload` needs
 * `upload_files`. A save the server refuses is an ApiRequestError with status 400 and code `invalid_blocks`. Replaced by the
 * content API (M1.1) and the media library (M1.2).
 */
export function createEditorPrototypeApi(api: ApiCall) {
  return {
    /** The signed-in account's own prototype draft (no blocks before the first save). */
    get: async () => PrototypeDocument.parse(await api(`${BASE}/document`)),
    /** Replaces the draft's blocks. The server checks them against each block.json again. */
    save: async (blocks: readonly unknown[]) =>
      PrototypeDocument.parse(await api(`${BASE}/document`, { method: 'PUT', body: { blocks } })),
    /** Keeps an image in the api's temporary folder and answers with its address on this site. */
    upload: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return PrototypeUploadResponse.parse(await api(`${BASE}/uploads`, { method: 'POST', body: form }))
    },
  }
}

export type EditorPrototypeApi = ReturnType<typeof createEditorPrototypeApi>

/** Call synchronously in setup, a plugin or middleware: it needs the Nuxt context. */
export function useEditorPrototypeApi(): EditorPrototypeApi {
  const { $api } = useNuxtApp()
  return createEditorPrototypeApi($api)
}
