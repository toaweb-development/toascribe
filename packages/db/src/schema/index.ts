// Drizzle schema of the toascribe core (PLAN «Datamodell i PostgreSQL»; docs/DATAMODEL.md), one file per domain.
// Everything exported here is a table: drizzle-kit, the client's relational queries and the schema tests read it.
export * from './accounts.ts'
export * from './content.ts'
export * from './taxonomy.ts'
export * from './media.ts'
export * from './site.ts'
export * from './integration.ts'
export * from './editorial.ts'
export * from './system.ts'
