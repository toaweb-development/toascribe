// Container healthcheck: `node dist/healthcheck.js`. Exits 0 when the worker's heartbeat file was
// touched recently (lib/heartbeat.ts), otherwise 1. Opens no port and needs no curl.
import { ConfigError, loadHealthcheckConfig } from './config.ts'
import { isHeartbeatFresh } from './lib/heartbeat.ts'

try {
  const { WORKER_HEARTBEAT_FILE } = loadHealthcheckConfig()
  process.exitCode = (await isHeartbeatFresh(WORKER_HEARTBEAT_FILE)) ? 0 : 1
} catch (err) {
  process.stderr.write(`healthcheck: ${err instanceof ConfigError ? err.message : 'unexpected error'}\n`)
  process.exitCode = 1
}
