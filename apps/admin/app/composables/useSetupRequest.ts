/** A call the wizard cannot go on from: the site is installed, or the setup code is not accepted. The wizard decides what happens. */
export type SetupLost = { kind: 'installed' } | { kind: 'token'; message: string }

/**
 * What every wizard step does around a call to the api: show that it is under way, keep the answer's error as a message for
 * the step (a new `failures` count makes the message take focus again), and hand a failure that no step can fix on to the
 * wizard (`onLost`). It returns the answer, or `undefined` when the call failed.
 */
export function useSetupRequest(onLost: (lost: SetupLost) => void) {
  const { t } = useI18n()
  const pending = ref(false)
  const error = ref<string>()
  const failures = ref(0)

  async function run<T>(call: () => Promise<T>): Promise<T | undefined> {
    pending.value = true
    error.value = undefined
    try {
      return await call()
    } catch (caught) {
      const failure = classifySetupFailure(caught)
      if (failure.kind === 'installed') {
        onLost({ kind: 'installed' })
      } else if (failure.kind === 'token') {
        onLost({ kind: 'token', message: describeApiError(caught, t) })
      } else {
        error.value = describeApiError(caught, t)
        failures.value += 1
      }
      return undefined
    } finally {
      pending.value = false
    }
  }

  return { pending, error, failures, run }
}
