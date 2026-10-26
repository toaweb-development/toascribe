import { MediaItem } from '@toascribe/shared'

// Upload with progress (K-117, «Legg til ny»): $fetch has no upload progress, so the file goes with XMLHttpRequest, with what $api
// would send: the session cookie (same origin), the CSRF token held in memory (fetched first after a reload), and an ApiRequestError
// from the same parser when it fails. No timeout: a large file on a slow line may take minutes; the api's body limit stops a stream.

export interface UploadHandle {
  readonly done: Promise<MediaItem>
  abort(): void
}

export function useMediaUpload() {
  const { $api, $csrf } = useNuxtApp()
  const config = useRuntimeConfig()

  async function token(): Promise<string | undefined> {
    if ($csrf.get() === undefined) {
      try {
        await $api('/v1/auth/session')
      } catch {
        // The upload fails with its own error (a 403 without a token).
      }
    }
    return $csrf.get()
  }

  /** POSTs a file as multipart to a media path (`/v1/media`, `/v1/media/{id}/replace`), reporting progress from 0 to 1. */
  function send(
    path: string,
    file: File,
    fields: Readonly<Record<string, string>>,
    onProgress: (fraction: number) => void,
  ): UploadHandle {
    const request = new XMLHttpRequest()
    const done = token().then(
      (csrf) =>
        new Promise<MediaItem>((resolve, reject) => {
          const form = new FormData()
          form.append('file', file)
          for (const [key, value] of Object.entries(fields)) form.append(key, value)
          request.open('POST', `${config.public.apiBase}${path}`)
          request.withCredentials = true
          request.setRequestHeader('Accept', 'application/json')
          if (csrf !== undefined) request.setRequestHeader(CSRF_HEADER, csrf)
          request.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total)
          })
          request.addEventListener('load', () => {
            let data: unknown
            try {
              data = JSON.parse(request.responseText) as unknown
            } catch {
              data = undefined
            }
            if (request.status >= 200 && request.status < 300) {
              const parsed = MediaItem.safeParse(data)
              if (parsed.success) {
                onProgress(1)
                resolve(parsed.data)
              } else {
                reject(new ApiRequestError({ status: request.status, code: 'unreadable' }))
              }
              return
            }
            const headers = { get: (name: string) => request.getResponseHeader(name) }
            reject(toApiRequestError({ status: request.status, data, response: { headers } }))
          })
          request.addEventListener('error', () => reject(new ApiRequestError({ code: 'network' })))
          request.addEventListener('abort', () => reject(new ApiRequestError({ code: 'aborted' })))
          request.send(form)
        }),
    )
    return { done, abort: () => request.abort() }
  }

  return { send }
}
