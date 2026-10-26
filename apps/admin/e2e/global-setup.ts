import { ensureInstalled, resetLimits, setSetting } from './helpers/stack.ts'

// Before the run: the site is installed, and the settings the tests change are at their defaults, whatever an earlier run left behind (a run that was
// stopped half way). The specs that need another value set it themselves and put it back.
export default async function globalSetup(): Promise<void> {
  // Until the site is installed every page goes to the setup wizard, so the stack is installed first (through the CLI).
  await ensureInstalled()
  await setSetting('users_can_register', false)
  await setSetting('mfa_required_roles', [])
  await setSetting('blogname', '')
  // The notices to every administrator about a new account or a changed password (K-017; the api tests cover them) are off
  // here. No spec reads them, and with them on, every account the specs make and every password they change mails each
  // administrator the suite has made so far: hundreds of mails in one run. The worker sends about one and a half a second,
  // so the queue fell behind and a reset mail that a spec waits for came too late.
  await setSetting('notify_admin_new_user', false)
  await setSetting('notify_admin_password_change', false)
  await resetLimits()
}
