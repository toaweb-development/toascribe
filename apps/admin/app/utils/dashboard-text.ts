// The dashboard's words that depend on a value (M1.8, K-033): the greeting by the hour (M2.1), the parts of «Aktivitet» and the
// statuses and checks of «Nettstedshelse». Each is asked for here with a literal translate call, so the root test (test/i18n-strings.test.ts) sees it.
import type { SiteHealthTest } from '@toascribe/shared'

/** vue-i18n's `t`, with a count as its second argument where a message has plural forms (the count is also `{n}`). */
type T = (key: string, count?: number) => string
type Named = (key: string, named: Record<string, string>) => string
type Status = SiteHealthTest['status']
type Issue = Exclude<Status, 'good'>

export type GreetingPart = 'morning' | 'forenoon' | 'afternoon' | 'evening'

/** «God morgen» from five until ten, «God formiddag» until twelve, «God ettermiddag» until six, «God kveld» after that and at night. */
export function greetingPart(hour: number): GreetingPart {
  if (hour >= 5 && hour < 10) return 'morning'
  if (hour >= 10 && hour < 12) return 'forenoon'
  if (hour >= 12 && hour < 18) return 'afternoon'
  return 'evening'
}

export const GREETINGS: Readonly<Record<GreetingPart, (t: Named, name: string) => string>> = {
  morning: (t, name) => t('dashboard.greeting.morning', { name }),
  forenoon: (t, name) => t('dashboard.greeting.forenoon', { name }),
  afternoon: (t, name) => t('dashboard.greeting.afternoon', { name }),
  evening: (t, name) => t('dashboard.greeting.evening', { name }),
}

export const ACTIVITY_PARTS = {
  soon: (t: T) => t('dashboard.activity.soon'),
  recent: (t: T) => t('dashboard.activity.recent'),
} as const

export const ACTIVITY_BADGES = {
  soon: (t: T) => t('dashboard.activity.badge.soon'),
  recent: (t: T) => t('dashboard.activity.badge.recent'),
} as const

export const HEALTH_OVERALL: Readonly<Record<Status, (t: T) => string>> = {
  good: (t) => t('dashboard.health.overall.good'),
  recommended: (t) => t('dashboard.health.overall.recommended'),
  critical: (t) => t('dashboard.health.overall.critical'),
}

export const HEALTH_TESTS: Readonly<Record<SiteHealthTest['key'], Readonly<Record<Issue, (t: T) => string>>>> = {
  worker: {
    recommended: (t) => t('dashboard.health.tests.worker.recommended'),
    critical: (t) => t('dashboard.health.tests.worker.critical'),
  },
  migrations: {
    recommended: (t) => t('dashboard.health.tests.migrations.recommended'),
    critical: (t) => t('dashboard.health.tests.migrations.critical'),
  },
  backup: {
    recommended: (t) => t('dashboard.health.tests.backup.recommended'),
    critical: (t) => t('dashboard.health.tests.backup.critical'),
  },
  updates: {
    recommended: (t) => t('dashboard.health.tests.updates.recommended'),
    critical: (t) => t('dashboard.health.tests.updates.critical'),
  },
  email: {
    recommended: (t) => t('dashboard.health.tests.email.recommended'),
    critical: (t) => t('dashboard.health.tests.email.critical'),
  },
  cache: {
    recommended: (t) => t('dashboard.health.tests.cache.recommended'),
    critical: (t) => t('dashboard.health.tests.cache.critical'),
  },
  debug: {
    recommended: (t) => t('dashboard.health.tests.debug.recommended'),
    critical: (t) => t('dashboard.health.tests.debug.critical'),
  },
  searchEngines: {
    recommended: (t) => t('dashboard.health.tests.searchEngines.recommended'),
    critical: (t) => t('dashboard.health.tests.searchEngines.critical'),
  },
}
