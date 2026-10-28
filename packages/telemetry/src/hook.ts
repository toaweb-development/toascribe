// Registers OpenTelemetry's ESM hook, so modules imported after it (http, pg) can be instrumented (M1.8, K-298). Only `node:module`
// is loaded here; the app's entry point calls it first, and only when OTEL_EXPORTER_OTLP_ENDPOINT is set.
import { register } from 'node:module'

export function registerInstrumentationHook(): void {
  // OpenTelemetry's documented way for ESM (doc/esm-support.md, verified 2026-10-28); Node marks `register` deprecated in favour of
  // `registerHooks`, which the hook package does not offer for this yet. Tested in apps/api/test/telemetry-process.test.ts.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url)
}
