import type { Preferences, UpdatePreferencesRequest } from '@toascribe/shared'

const PREFERENCES_KEY = 'admin:preferences'

/**
 * The signed-in account's preferences (`GET /me`, `PATCH /me/preferences`): the colour scheme, the toolbar choice and whether the
 * welcome panel has been dismissed. One copy in the Nuxt state, so the shell, the dashboard and the profile page see the same
 * values at once and the server-rendered page hands them to the browser. The sign-in check (middleware/signed-in.ts) loads them
 * before a shell page is drawn, which is why the colour scheme is right on the first paint.
 *
 * Call it synchronously in setup or middleware (it needs the Nuxt context); the functions it returns can be called later.
 */
export function useAdminPreferences() {
  const meApi = useMeApi()
  const preferences = useState<Preferences | undefined>(PREFERENCES_KEY, () => undefined)
  /** True when the last load failed and there is nothing to show. */
  const failed = useState<boolean>(`${PREFERENCES_KEY}:failed`, () => false)

  /** Reads the account's preferences if they are not held yet. Never throws: a failure is `failed`, and the shell goes on with the defaults. */
  async function ensure(): Promise<void> {
    if (preferences.value !== undefined) {
      return
    }
    await reload()
  }

  /** Asks again (the retry of a part that could not load). */
  async function reload(): Promise<void> {
    try {
      preferences.value = (await meApi.get()).preferences
      failed.value = false
    } catch {
      failed.value = preferences.value === undefined
    }
  }

  /**
   * Saves some preferences and keeps the answer (all of them). Throws the ApiRequestError, so the caller says what failed and the
   * old values stay on screen.
   */
  async function update(changes: UpdatePreferencesRequest): Promise<Preferences> {
    const saved = await meApi.updatePreferences(changes)
    preferences.value = saved
    failed.value = false
    return saved
  }

  /** What the shell is left with when nobody is signed in: the next account must not see this one's colours or panels. */
  function forget(): void {
    preferences.value = undefined
    failed.value = false
  }

  return { preferences, failed, ensure, reload, update, forget }
}
