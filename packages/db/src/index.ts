// @toascribe/db: imported only by apps/api and apps/worker (typescript §7).
// The migration runner is a separate entry point, dist/migrate.js (`pnpm --filter @toascribe/db migrate`).
export { checkConnection, createDb } from './client.ts'
export type { CreateDbOptions, Database, Db, Schema } from './client.ts'
export { PGBOSS_APP_OPTIONS, PGBOSS_SCHEMA } from './pgboss.ts'
export * as schema from './schema/index.ts'
