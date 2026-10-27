// @toascribe/db: imported only by apps/api, apps/worker and the cli (typescript §7).
// The migration runner is a separate entry point, dist/migrate.js (`pnpm --filter @toascribe/db migrate`); runMigrations
// is exported too for the CLI (`toa core install`, `toa dev`), which must pass it the owner role's URL, never the app's.
export { checkConnection, createDb } from './client.ts'
export type { CreateDbOptions, Database, Db, Schema } from './client.ts'
export { getMigrationStatus, readMigrationJournal } from './migration-status.ts'
export type { MigrationStatus } from './migration-status.ts'
export { runMigrations } from './migrator.ts'
export type { RunMigrationsOptions } from './migrator.ts'
export { createMailProducer } from './mail-queue.ts'
export { MEDIA_QUEUE_OPTIONS, createMediaProducer } from './media-queue.ts'
export type { MediaProducer } from './media-queue.ts'
export type { MailProducer, MailProducerOptions, MailProducerReceipt } from './mail-queue.ts'
export { PGBOSS_APP_OPTIONS, PGBOSS_SCHEMA } from './pgboss.ts'
export { seedCore } from './seed.ts'
export type { SeedCoreResult } from './seed.ts'
export type { DbExecutor, DbTransaction } from './executor.ts'
export {
  AlreadyInstalledError,
  INSTALL_LOCK_KEY,
  deleteSiteSecret,
  dismissAdminNotice,
  getInstallState,
  getSiteSecret,
  lockInstall,
  markInstalled,
  raiseAdminNotice,
  resolveAdminNotice,
  setSiteSecret,
  writeSetting,
} from './install.ts'
export type { InstallState, SiteSecretRow } from './install.ts'
export { DefaultContentExistsError, seedDefaultContent } from './default-content/seed.ts'
export type { SeedDefaultContentInput, SeedDefaultContentResult } from './default-content/seed.ts'
export { DEFAULT_CONTENT_STRINGS, defaultContentStrings } from './default-content/strings.ts'
export type { DefaultContentLocale, DefaultContentStrings } from './default-content/strings.ts'
export { parseBlockMarkup } from './default-content/blocks.ts'
export type { ParsedBlock } from './default-content/blocks.ts'
export * as schema from './schema/index.ts'
export {
  HIERARCHICAL_TYPES,
  deleteContentPermanently,
  isReservedSlug,
  legacyBlocksText,
  lockSlugScope,
  removeFromMenus,
  uniqueContentSlug,
} from './content.ts'
export type { DeletedContent, SlugScope } from './content.ts'
