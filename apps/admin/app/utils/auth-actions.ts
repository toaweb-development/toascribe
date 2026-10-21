// `/admin/login` is one address with many faces, as `wp-login.php` is: the `action` in the query picks the screen, and a few
// other query names pick a notice above the login form. The names are WordPress' (K-009), so old bookmarks and the links
// in mails keep working. Anything else is the login form.

export type LoginAction =
  'login' | 'lostpassword' | 'resetpass' | 'setpassword' | 'confirmemail' | 'register' | 'logout'

// A Map, not an object: `action=constructor` must not find Object's own properties.
const ACTIONS: ReadonlyMap<string, LoginAction> = new Map<string, LoginAction>([
  ['login', 'login'],
  ['lostpassword', 'lostpassword'],
  ['retrievepassword', 'lostpassword'], // WordPress' older name
  ['resetpass', 'resetpass'],
  ['rp', 'resetpass'], // `wp-login.php?action=rp`
  ['setpassword', 'setpassword'],
  ['confirmemail', 'confirmemail'],
  ['register', 'register'],
  ['logout', 'logout'],
])

export function loginAction(value: unknown): LoginAction {
  return typeof value === 'string' ? (ACTIONS.get(value) ?? 'login') : 'login'
}

/** The notices above the login form. */
export type LoginNotice = 'loggedOut' | 'passwordChanged' | 'checkEmail' | 'registered'

/** `?loggedout=true`, `?password=changed`, `?checkemail=confirm` and `?checkemail=registered`, as WordPress sends them. */
export function loginNotice(query: Record<string, unknown>): LoginNotice | undefined {
  if (query.loggedout === 'true') return 'loggedOut'
  if (query.password === 'changed') return 'passwordChanged'
  if (query.checkemail === 'confirm') return 'checkEmail'
  if (query.checkemail === 'registered') return 'registered'
  return undefined
}

/** The query that shows a notice. */
export const NOTICE_QUERY: Readonly<Record<LoginNotice, Record<string, string>>> = {
  loggedOut: { loggedout: 'true' },
  passwordChanged: { password: 'changed' },
  checkEmail: { checkemail: 'confirm' },
  registered: { checkemail: 'registered' },
}

/** The actions that are meaningful with a session already open: the others send a signed-in person on. */
export function allowsSession(action: LoginAction): boolean {
  return action === 'resetpass' || action === 'setpassword' || action === 'confirmemail'
}
