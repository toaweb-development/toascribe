// The worker's start (M1.8, K-298). With OTEL_EXPORTER_OTLP_ENDPOINT set, OpenTelemetry's ESM hook is registered and the SDK started
// before the worker is loaded, so pg can be instrumented; without it nothing of OpenTelemetry is loaded and nothing is sent. Then
// the worker itself (main.ts). Nothing here imports pg or pg-boss: they must come after the hook.
import { readFileSync } from 'node:fs'

import { readTelemetryEndpoint } from './config.ts'
import { setTelemetry } from './lib/telemetry-handle.ts'

const endpoint = readTelemetryEndpoint()
if (endpoint !== undefined) {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version?: unknown
  }
  const { registerInstrumentationHook } = await import('@toascribe/telemetry/hook')
  registerInstrumentationHook()
  const { startTelemetry } = await import('@toascribe/telemetry')
  setTelemetry(
    startTelemetry({
      endpoint,
      serviceName: 'toascribe-worker',
      serviceVersion: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
    }),
  )
}

await import('./main.ts')
