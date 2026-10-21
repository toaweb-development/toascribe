// drizzle-kit config (typescript §10). `generate` writes SQL migrations to migrations/ and needs no
// database. Commands that connect (`check`, `push` on a local dev database only) use the owner role
// from MIGRATION_DATABASE_URL, never the app role. Production migrations run through src/migrate.ts.
import { defineConfig } from 'drizzle-kit'

const url = process.env['MIGRATION_DATABASE_URL']

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  casing: 'snake_case',
  // Drizzle owns public. pgboss belongs to pg-boss and drizzle (the migrations journal) to the migrator.
  schemaFilter: ['public'],
  strict: true,
  verbose: true,
  ...(url === undefined ? {} : { dbCredentials: { url } }),
})
