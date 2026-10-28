// Registers OpenTelemetry's ESM hook, so modules imported after it (http, pg) can be instrumented (M1.8, K-298). Only `node:module`
// is loaded here; the app's entry point calls it first, and only when OTEL_EXPORTER_OTLP_ENDPOINT is set.
import { register } from 'node:module'

export function registerInstrumentationHook(): void {
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url)
}
