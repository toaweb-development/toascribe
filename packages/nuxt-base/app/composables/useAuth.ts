import type { LoginResponse, MfaConfirmResponse, MfaVerifyRequest, MfaVerifyResponse } from '@toascribe/shared'

import type { LoginInput } from '../lib/api/auth.ts'
import { SESSION_STATE_KEY, UNKNOWN_SESSION, toSessionView } from '../lib/api/session.ts'
import type { SessionView } from '../lib/api/session.ts'

/**
 * The session of the person at the keyboard, for every sign-in screen. The state is in `useState`, so what the server
 * learned (from the cookie it forwarded) is there on the client without a second call; it holds no CSRF token, which is
 * kept in memory and fetched again after a reload (lib/api/client.ts).
 *
 * Call it synchronously in setup (it needs the Nuxt context); the functions it returns can be called later.
 */
export function useAuth() {
  const authApi = useAuthApi()
  const { $csrf } = useNuxtApp()
  const session = useState<SessionView>(SESSION_STATE_KEY, () => UNKNOWN_SESSION)

  /** Asks the API who is signed in, and keeps the answer. */
  async function refresh(): Promise<SessionView> {
    session.value = toSessionView(await authApi.session())
    return session.value
  }

  /** The answer held, or the API's if there is none yet. */
  async function ensure(): Promise<SessionView> {
    return session.value.status === 'unknown' ? refresh() : session.value
  }

  async function login(input: LoginInput): Promise<LoginResponse> {
    const answer = await authApi.login(input)
    session.value = toSessionView(answer)
    return answer
  }

  async function verifyMfa(body: MfaVerifyRequest): Promise<MfaVerifyResponse> {
    const answer = await authApi.verifyMfa(body)
    session.value = toSessionView(answer)
    return answer
  }

  /** The last step of enrolment. When it also finished the login, the session is complete: read it again. */
  async function confirmEnrolment(id: string, code: string, password?: string): Promise<MfaConfirmResponse> {
    const answer = await authApi.enrolConfirm(id, code, password)
    if (answer.loginCompleted) {
      await refresh()
    }
    return answer
  }

  /**
   * Ends the session on the server. The state is cleared when it worked, and when the API says there was no session; a
   * failure of any other kind (network, CSRF) leaves it alone, because the session is then still open.
   */
  async function logout(): Promise<void> {
    try {
      await authApi.logout()
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.status === 401) {
        forget()
      }
      throw caught
    }
    forget()
  }

  /** Nobody is signed in as far as this tab knows (after a logout, or a 401). */
  function forget(): void {
    $csrf.set(undefined)
    session.value = { status: 'anonymous' }
  }

  /** What is held may be wrong (a 401 came back): drop it and the CSRF token, so the next `ensure()` asks the API. */
  function invalidate(): void {
    $csrf.set(undefined)
    session.value = UNKNOWN_SESSION
  }

  return {
    session,
    refresh,
    ensure,
    login,
    verifyMfa,
    enrolStart: authApi.enrolStart,
    confirmEnrolment,
    logout,
    forget,
    invalidate,
  }
}
