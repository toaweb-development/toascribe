// Container healthcheck: `node dist/healthcheck.js`. Exits 0 when GET /api/health on this
// container's own port answers 200, otherwise 1. Needs no curl, so it works in a slim Node image.
import { ConfigError, loadHealthcheckConfig } from './config.ts'
import { probeHealth } from './lib/probe.ts'

try {
  const { PORT } = loadHealthcheckConfig()
  process.exitCode = (await probeHealth(`http://127.0.0.1:${String(PORT)}/api/health`)) ? 0 : 1
} catch (err) {
  process.stderr.write(`healthcheck: ${err instanceof ConfigError ? err.message : 'unexpected error'}\n`)
  process.exitCode = 1
}
