// @toascribe/telemetry (M1.8, K-298): OpenTelemetry for the api and the worker, off by default. The app's entry point imports this
// only when OTEL_EXPORTER_OTLP_ENDPOINT is set (after registering the ESM hook, `@toascribe/telemetry/hook`), so without the
// variable nothing of it is loaded and nothing is sent. Traces and metrics go over OTLP/HTTP to that address and nowhere else (the
// exporters are given their addresses; nothing is read from other OTEL_* variables), with the log's hidden fields hidden in every span.
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace'
import type { SpanExporter } from '@opentelemetry/sdk-trace'

import { scrubbingSpanProcessor } from './scrub.ts'

export { scrubAttribute, scrubAttributes, scrubSpan, scrubbingSpanProcessor } from './scrub.ts'

export interface TelemetryOptions {
  /** OTEL_EXPORTER_OTLP_ENDPOINT: the collector's base address (`/v1/traces` and `/v1/metrics` are added). */
  readonly endpoint: string
  readonly serviceName: string
  readonly serviceVersion: string
  /** A test passes its own (in memory); the default sends to the endpoint. */
  readonly traceExporter?: SpanExporter
}

export interface Telemetry {
  /** Sends what is left and stops. */
  shutdown(): Promise<void>
}

export function startTelemetry(options: TelemetryOptions): Telemetry {
  const base = options.endpoint.replace(/\/+$/, '')
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': options.serviceName,
      'service.version': options.serviceVersion,
    }),
    spanProcessors: [
      scrubbingSpanProcessor(),
      new BatchSpanProcessor({
        exporter: options.traceExporter ?? new OTLPTraceExporter({ url: `${base}/v1/traces` }),
      }),
    ],
    metricReaders: [
      new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics` }) }),
    ],
    instrumentations: [
      // No headers are recorded (none is listed); the query of an address is dropped by the scrubber.
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (request) => request.url === '/api/health' || request.url === '/api/ready',
      }),
      // The SQL text with its $1 placeholders, never the values.
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
    ],
  })
  sdk.start()
  return { shutdown: () => sdk.shutdown() }
}
