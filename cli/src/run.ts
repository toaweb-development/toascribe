// The command logic, free of process I/O so tests can call it directly. No CLI framework is pulled in; the command
// set (docs/PLAN.md, «toa-CLI») grows with the features it operates on.
import { coreGenEnv, coreInstall, coreIsInstalled, coreSetupToken } from './commands/core.ts'
import { devSeedTom } from './commands/dev-seed.ts'
import { backup, dbMigrate } from './commands/backup.ts'
import { checkUpdate } from './commands/check-update.ts'
import { menu, post, term } from './commands/content.ts'
import { option } from './commands/option.ts'
import { cache, jobs, secrets } from './commands/ops.ts'
import { shell } from './commands/shell.ts'
import { maintenance } from './commands/maintenance.ts'
import { mediaRegenerate } from './commands/media.ts'
import { userCreate, userMfaReset, userResetLoginLimit, userResetPassword } from './commands/user.ts'
import type { CommandOptions } from './options.ts'
import type { CliResult } from './result.ts'
import { USAGE } from './usage.ts'

export type { CliResult } from './result.ts'
export type { CommandOptions } from './options.ts'
export { USAGE } from './usage.ts'

/** Fixtures the plan names for later milestones. */
const FUTURE_FIXTURES = ['blogg', 'stor', 'butikk'] as const

export async function run(argv: readonly string[], version: string, options: CommandOptions = {}): Promise<CliResult> {
  const [command, ...rest] = argv
  if (
    ((command === 'version' || command === '--version') && rest.length === 0) ||
    (command === 'core' && rest[0] === 'version' && rest.length === 1)
  ) {
    return { code: 0, stdout: `${version}\n`, stderr: '' }
  }
  if (command === 'dev' && rest[0] === 'seed' && rest.length === 2) {
    const fixture = rest[1] ?? ''
    if (fixture === 'tom') {
      return await devSeedTom(options)
    }
    if ((FUTURE_FIXTURES as readonly string[]).includes(fixture)) {
      return { code: 2, stdout: '', stderr: `The fixture "${fixture}" is not available yet. Only "tom" is.\n` }
    }
  }
  if (command === 'core' && rest[0] === 'gen-env') {
    return coreGenEnv(rest.slice(1), options)
  }
  if (command === 'core' && rest[0] === 'is-installed') {
    return await coreIsInstalled(rest.slice(1), options)
  }
  if (command === 'core' && rest[0] === 'setup-token') {
    return await coreSetupToken(rest.slice(1), options)
  }
  if (command === 'core' && rest[0] === 'install') {
    return await coreInstall(rest.slice(1), options)
  }
  if (command === 'backup') {
    return await backup(rest, options)
  }
  if (command === 'db' && rest[0] === 'migrate') {
    return await dbMigrate(rest.slice(1), options)
  }
  if (command === 'core' && rest[0] === 'update') {
    return await dbMigrate(rest.slice(1), options, 'core update')
  }
  if (command === 'check-update') {
    return await checkUpdate(rest, version, options)
  }
  if (command === 'core' && rest[0] === 'check-update') {
    return await checkUpdate(rest.slice(1), version, options)
  }
  const withVersion = { ...options, version }
  if (command === 'post') return await post(rest, withVersion)
  if (command === 'term') return await term(rest, withVersion)
  if (command === 'menu') return await menu(rest, withVersion)
  if (command === 'option') return await option(rest, withVersion)
  if (command === 'cache') return await cache(rest, options)
  if (command === 'jobs') return await jobs(rest, options)
  if (command === 'secrets') return await secrets(rest, options)
  if (command === 'shell') return await shell(rest, withVersion)
  if (command === 'maintenance') {
    return await maintenance(rest, options)
  }
  if (command === 'media' && rest[0] === 'regenerate') {
    return await mediaRegenerate(rest.slice(1), options)
  }
  if (command === 'user' && rest[0] === 'create') {
    return await userCreate(rest.slice(1), options)
  }
  if (command === 'user' && rest[0] === 'reset-password') {
    return await userResetPassword(rest.slice(1), options)
  }
  if (command === 'user' && rest[0] === 'reset-login-limit') {
    return await userResetLoginLimit(rest.slice(1), options)
  }
  if (command === 'user' && rest[0] === 'mfa-reset') {
    return await userMfaReset(rest.slice(1), options)
  }
  return { code: 2, stdout: '', stderr: USAGE }
}
