// Nettstedshelse's labels (M1.7, K-203): the groups, fields and words come from the api by name. Each is asked for here with a
// literal translate call, so the root test (test/i18n-strings.test.ts) sees it in use; a name the catalogue does not have shows as
// itself (a field) or falls back to «Status».
import type { Translator } from './shell-text.ts'

type Lookup = Readonly<Record<string, (t: Translator['t']) => string>>

const GROUPS: Lookup = {
  toascribe: (t) => t('siteHealth.groups.toascribe'),
  server: (t) => t('siteHealth.groups.server'),
  database: (t) => t('siteHealth.groups.database'),
  cache: (t) => t('siteHealth.groups.cache'),
  worker: (t) => t('siteHealth.groups.worker'),
  site: (t) => t('siteHealth.groups.site'),
  media: (t) => t('siteHealth.groups.media'),
  backup: (t) => t('siteHealth.groups.backup'),
  updates: (t) => t('siteHealth.groups.updates'),
}

const FIELDS: Lookup = {
  'toascribe.version': (t) => t('siteHealth.fields.toascribe.version'),
  'toascribe.migration': (t) => t('siteHealth.fields.toascribe.migration'),
  'toascribe.environment': (t) => t('siteHealth.fields.toascribe.environment'),
  'server.node': (t) => t('siteHealth.fields.server.node'),
  'server.os': (t) => t('siteHealth.fields.server.os'),
  'server.memoryTotal': (t) => t('siteHealth.fields.server.memoryTotal'),
  'server.memoryFree': (t) => t('siteHealth.fields.server.memoryFree'),
  'server.apiMemory': (t) => t('siteHealth.fields.server.apiMemory'),
  'database.version': (t) => t('siteHealth.fields.database.version'),
  'database.size': (t) => t('siteHealth.fields.database.size'),
  'cache.backend': (t) => t('siteHealth.fields.cache.backend'),
  'cache.answers': (t) => t('siteHealth.fields.cache.answers'),
  'worker.status': (t) => t('siteHealth.fields.worker.status'),
  'worker.lastSeen': (t) => t('siteHealth.fields.worker.lastSeen'),
  'worker.queues': (t) => t('siteHealth.fields.worker.queues'),
  'worker.queued': (t) => t('siteHealth.fields.worker.queued'),
  'worker.active': (t) => t('siteHealth.fields.worker.active'),
  'worker.failed': (t) => t('siteHealth.fields.worker.failed'),
  'site.theme': (t) => t('siteHealth.fields.site.theme'),
  'site.language': (t) => t('siteHealth.fields.site.language'),
  'site.timezone': (t) => t('siteHealth.fields.site.timezone'),
  'site.permalinks': (t) => t('siteHealth.fields.site.permalinks'),
  'site.public': (t) => t('siteHealth.fields.site.public'),
  'media.files': (t) => t('siteHealth.fields.media.files'),
  'media.size': (t) => t('siteHealth.fields.media.size'),
  'media.uploadMax': (t) => t('siteHealth.fields.media.uploadMax'),
  'backup.last': (t) => t('siteHealth.fields.backup.last'),
  'backup.ok': (t) => t('siteHealth.fields.backup.ok'),
  'backup.file': (t) => t('siteHealth.fields.backup.file'),
  'backup.size': (t) => t('siteHealth.fields.backup.size'),
  'backup.scheduled': (t) => t('siteHealth.fields.backup.scheduled'),
  'updates.enabled': (t) => t('siteHealth.fields.updates.enabled'),
  'updates.lastCheck': (t) => t('siteHealth.fields.updates.lastCheck'),
  'updates.latest': (t) => t('siteHealth.fields.updates.latest'),
  'updates.available': (t) => t('siteHealth.fields.updates.available'),
}

const VALUES: Lookup = {
  production: (t) => t('siteHealth.values.production'),
  development: (t) => t('siteHealth.values.development'),
  test: (t) => t('siteHealth.values.test'),
  memory: (t) => t('siteHealth.values.memory'),
  valkey: (t) => t('siteHealth.values.valkey'),
  running: (t) => t('siteHealth.values.running'),
  notRunning: (t) => t('siteHealth.values.notRunning'),
  unavailable: (t) => t('siteHealth.values.unavailable'),
}

/** The heading of a group. */
export function siteHealthGroup({ t }: Translator, group: string): string {
  return GROUPS[group]?.(t) ?? group
}

/** The label of a field in a group. */
export function siteHealthField({ t }: Translator, group: string, field: string): string {
  return FIELDS[`${group}.${field}`]?.(t) ?? t('siteHealth.fields.error')
}

/** A word value (an environment, a store, a state) in words. */
export function siteHealthWord({ t }: Translator, value: string): string {
  return VALUES[value]?.(t) ?? value
}
