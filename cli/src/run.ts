// The command logic, free of process I/O so tests can call it directly. No CLI framework is pulled in; the command
// set (docs/PLAN.md, «toa-CLI») grows with the features it operates on.
import { devSeedTom } from './commands/dev-seed.ts'
import { userCreate, userResetLoginLimit, userResetPassword } from './commands/user.ts'
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
  if ((command === 'version' || command === '--version') && rest.length === 0) {
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
  if (command === 'user' && rest[0] === 'create') {
    return await userCreate(rest.slice(1), options)
  }
  if (command === 'user' && rest[0] === 'reset-password') {
    return await userResetPassword(rest.slice(1), options)
  }
  if (command === 'user' && rest[0] === 'reset-login-limit') {
    return await userResetLoginLimit(rest.slice(1), options)
  }
  return { code: 2, stdout: '', stderr: USAGE }
}
