import { HealthResponse } from '@toascribe/shared'

/** True when `url` answers 200 with a valid HealthResponse within timeoutMs. */
export async function probeHealth(url: string, timeoutMs = 3000): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (response.status !== 200) {
      return false
    }
    return HealthResponse.safeParse(await response.json()).success
  } catch {
    return false
  }
}
