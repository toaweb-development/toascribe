// @toascribe/db: imported only by apps/api, apps/worker and the cli (typescript §7).
// The migration runner is a separate entry point, dist/migrate.js (`pnpm --filter @toascribe/db migrate`); runMigrations
// is exported too for the CLI (`toa core install`, `toa dev`), which must pass it the owner role's URL, never the app's.
export { checkConnection, createDb } from './client.ts'
export type { CreateDbOptions, Database, Db, Schema } from './client.ts'
export { runMigrations } from './migrator.ts'
export type { RunMigrationsOptions } from './migrator.ts'
export { createMailProducer } from './mail-queue.ts'
export type { MailProducer, MailProducerOptions, MailProducerReceipt } from './mail-queue.ts'
export { PGBOSS_APP_OPTIONS, PGBOSS_SCHEMA } from './pgboss.ts'
export { seedCore } from './seed.ts'
export type { SeedCoreResult } from './seed.ts'
export * as schema from './schema/index.ts'
