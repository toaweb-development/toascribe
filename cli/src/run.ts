// The command logic, free of process I/O so tests can call it directly. No CLI framework is pulled in; the command
// set (docs/PLAN.md, «toa-CLI») grows with the features it operates on.
import { devSeedTom } from './commands/dev-seed.ts'
import type { DevSeedOptions } from './commands/dev-seed.ts'
import type { CliResult } from './result.ts'

export type { CliResult } from './result.ts'

export const USAGE = `Usage: toa <command>

Commands:
  version, --version     Print the toascribe version
  dev seed tom           Empty a development database, run the migrations and seed the roles and settings.
                         Refuses unless NODE_ENV is development or test. Needs MIGRATION_DATABASE_URL (owner role).
`

/** Fixtures the plan names for later milestones. */
const FUTURE_FIXTURES = ['blogg', 'stor', 'butikk'] as const

export async function run(argv: readonly string[], version: string, options: DevSeedOptions = {}): Promise<CliResult> {
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
  return { code: 2, stdout: '', stderr: USAGE }
}
