/**
 * Runs `work` and does not return before `minimumMs` has passed, whether it succeeded or threw. The account flows that must
 * not reveal whether an account exists (lost password, registration, e-mail change) do more work when it does, a few
 * queries and a queued mail; padding every answer to the same minimum hides that difference from anyone timing the response.
 */
export async function withMinimumDuration<T>(minimumMs: number, work: () => Promise<T>): Promise<T> {
  const started = performance.now()
  try {
    return await work()
  } finally {
    const remaining = minimumMs - (performance.now() - started)
    if (remaining > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, remaining)
      })
    }
  }
}

/** The answer time of those flows. Longer than the work takes with a healthy database and queue; short enough not to be felt. */
export const ACCOUNT_FLOW_MINIMUM_MS = 400
