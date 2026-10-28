// The api's start (M1.8, K-298). With OTEL_EXPORTER_OTLP_ENDPOINT set, OpenTelemetry's ESM hook is registered and the SDK started
// before the app is loaded, so http and pg can be instrumented; without it nothing of OpenTelemetry is loaded and nothing is sent.
// Then the app itself (main.ts). Nothing here imports http, pg or Hono: they must come after the hook.
import { readTelemetryEndpoint } from './config.ts'
import { setTelemetry } from './lib/telemetry-handle.ts'
import { readPackageVersion } from './lib/version.ts'

const endpoint = readTelemetryEndpoint()
if (endpoint !== undefined) {
  const { registerInstrumentationHook } = await import('@toascribe/telemetry/hook')
  registerInstrumentationHook()
  const { startTelemetry } = await import('@toascribe/telemetry')
  setTelemetry(startTelemetry({ endpoint, serviceName: 'toascribe-api', serviceVersion: readPackageVersion() }))
}

await import('./main.ts')
