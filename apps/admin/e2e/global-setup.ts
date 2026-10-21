import { resetLimits, setSetting } from './helpers/stack.ts'

// Before the run: the settings the tests change are at their defaults, whatever an earlier run left behind (a run that was
// stopped half way). The specs that need another value set it themselves and put it back.
export default async function globalSetup(): Promise<void> {
  await setSetting('users_can_register', false)
  await setSetting('mfa_required_roles', [])
  await resetLimits()
}
