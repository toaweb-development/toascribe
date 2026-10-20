#!/usr/bin/env node
// The `toa` command: `node dist/index.js` (package.json bin). Runs in the api container:
// `docker compose exec api toa …`.
import { run } from './run.ts'
import { readVersion } from './version.ts'

const result = run(process.argv.slice(2), readVersion())
process.stdout.write(result.stdout)
process.stderr.write(result.stderr)
process.exitCode = result.code
