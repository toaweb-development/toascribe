// The password rule that is not about length (length is `NewPassword` in @toascribe/shared). One copy, so the api, the install
// service and the cli cannot drift apart: install, /me/password, reset, «set password» and `toa user` all ask here.

/** What a person is told when `isTooObvious` refuses. The api sends it as the message of 400 `weak_password`. */
export const WEAK_PASSWORD_MESSAGE = 'Choose a password that is not your username or your e-mail address.'

/**
 * The password is the account's own username or e-mail address (case is ignored on both sides, as the database compares them).
 * Nothing else is judged here.
 */
export function isTooObvious(
  password: string,
  account: { readonly username: string; readonly email: string },
): boolean {
  const lower = password.toLowerCase()
  return lower === account.username.toLowerCase() || lower === account.email.toLowerCase()
}
