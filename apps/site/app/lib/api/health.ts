import { HealthResponse } from '@toascribe/shared'

/** What the API layer needs from $fetch: a path in, an unknown body out. The body is parsed, never cast. */
export type ApiFetch = (path: string) => Promise<unknown>

/** GET /api/health. The response is parsed with the shared schema, so a wrong body is an error, not a lie. */
export function createHealthApi(api: ApiFetch) {
  return {
    get: async (): Promise<HealthResponse> => HealthResponse.parse(await api('/health')),
  }
}

/** Call synchronously in setup, a plugin or middleware: it needs the Nuxt context. */
export function useHealthApi() {
  const { $api } = useNuxtApp()
  return createHealthApi((path) => $api(path))
}
