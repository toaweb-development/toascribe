import { PrototypeUploadResponse } from '@toascribe/shared'

import type { ApiCall } from './client.ts'

const BASE = '/v1/prototype/editor'

/**
 * PROTOTYPE (M0.6): the editor's image uploads (`upload_files`), kept in the api's temporary folder until the media library of
 * M1.2 replaces them. The editor saves its content through the content API (lib/api/content.ts).
 */
export function createEditorPrototypeApi(api: ApiCall) {
  return {
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
