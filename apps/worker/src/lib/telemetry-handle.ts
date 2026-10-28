// The running OpenTelemetry, if index.ts started one (M1.8, K-298): the clean shutdown sends what is left before the process exits.
let current: { shutdown(): Promise<void> } | undefined

export function setTelemetry(telemetry: { shutdown(): Promise<void> }): void {
  current = telemetry
}

/** Sends what is left and stops; nothing when telemetry is off. Never throws: a collector that is away must not fail a shutdown. */
export async function flushTelemetry(): Promise<void> {
  await current?.shutdown().catch(() => undefined)
}
