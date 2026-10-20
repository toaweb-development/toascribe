// The command logic, free of process I/O so tests can call it directly.
// M0.1 has two commands, `--version` / `version`. The real command set (docs/PLAN.md, «toa-CLI»)
// comes with the features it operates on; until then no CLI framework is pulled in.

export interface CliResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export const USAGE = `Usage: toa <command>

Commands:
  version, --version   Print the toascribe version
`

export function run(argv: readonly string[], version: string): CliResult {
  const [command, ...rest] = argv
  if ((command === 'version' || command === '--version') && rest.length === 0) {
    return { code: 0, stdout: `${version}\n`, stderr: '' }
  }
  return { code: 2, stdout: '', stderr: USAGE }
}
