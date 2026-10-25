import type { AssignRoleResponse, AssignRoleSkipReason } from '@toascribe/shared'

// The words of the users list that depend on data: a role's name, and what to say after «Endre» (who was changed, who already had the
// role, who was left alone and why). Every message is asked for with a literal key, so the root test (test/i18n-strings.test.ts) sees
// that it is in use, and no function here prints a key or a reason code to the person.

/** vue-i18n's `t`, as far as it is used here: a key, then named values, then the number that picks a plural form. */
export type MessageT = (key: string, named?: Record<string, string | number>, plural?: number) => string

/**
 * A role's name. The five built-in roles are translated (WordPress' Norwegian names); any other role shows the name it was
 * stored with, since the admin has no translation for a role somebody made.
 */
export function roleLabel(t: MessageT, slug: string, storedName: string | undefined): string {
  switch (slug) {
    case 'administrator':
      return t('roles.administrator')
    case 'editor':
      return t('roles.editor')
    case 'author':
      return t('roles.author')
    case 'contributor':
      return t('roles.contributor')
    case 'subscriber':
      return t('roles.subscriber')
    default:
      return storedName ?? slug
  }
}

/** An account's roles as a sentence part: «Redaktør, Forfatter», or «Ingen rolle». */
export function rolesText(t: MessageT, slugs: readonly string[], nameOf: (slug: string) => string | undefined): string {
  return slugs.length === 0
    ? t('users.noRole')
    : slugs.map((slug) => roleLabel(t, slug, nameOf(slug))).join(t('users.roleSeparator'))
}

/** How many names a message lists before it says «og n til». */
export const MAX_NAMES_LISTED = 5

/** «anna, bjorn og 3 til». */
export function namesText(t: MessageT, names: readonly string[]): string {
  if (names.length <= MAX_NAMES_LISTED) {
    return names.join(', ')
  }
  return `${names.slice(0, MAX_NAMES_LISTED).join(', ')} ${t('users.nameList.more', { n: names.length - MAX_NAMES_LISTED })}`
}

/** The order the lines are read in: what the person did wrong or cannot do first, a stale list last. */
const SKIP_ORDER: readonly AssignRoleSkipReason[] = ['self', 'last_administrator', 'forbidden_user', 'not_found']

function skippedText(t: MessageT, reason: AssignRoleSkipReason, names: string): string {
  switch (reason) {
    case 'self':
      return t('users.roleSkipped.self')
    case 'last_administrator':
      return t('users.roleSkipped.lastAdministrator', { users: names })
    case 'forbidden_user':
      return t('users.roleSkipped.forbiddenUser', { users: names })
    case 'not_found':
      return t('users.roleSkipped.notFound', { users: names })
  }
}

export interface RoleChangeInput {
  response: AssignRoleResponse
  /** The username of each account the person ticked, by id. An id that is not here is named with the fallback text. */
  usernames: ReadonlyMap<string, string>
  /** The name of the role that was given. */
  roleName: string
}

export interface RoleChangeReport {
  /** `success` only when every account was changed; `info` when nothing needed changing; `warning` when anyone was left alone. */
  tone: 'success' | 'warning' | 'info'
  title: string
  /** One line each, for the accounts that were left as they were (workflows §25: never imply more success than there was). */
  details: string[]
}

/** What the screen says after «Endre» (workflows §25: partial success lists who was changed and who was not, and why). */
export function describeRoleChange({ response, usernames, roleName }: RoleChangeInput, t: MessageT): RoleChangeReport {
  const { changed, unchanged, skipped } = response
  const nameOf = (id: string) => usernames.get(id) ?? t('users.unknownUser')
  const details: string[] = []

  if (skipped.length > 0) {
    details.push(t('users.roleChanged.skippedCount', { n: skipped.length }, skipped.length))
    // One line for each reason; the accounts of a reason are named together.
    for (const reason of SKIP_ORDER) {
      const ofReason = skipped.filter((entry) => entry.reason === reason)
      if (ofReason.length > 0) {
        details.push(
          skippedText(
            t,
            reason,
            namesText(
              t,
              ofReason.map((entry) => nameOf(entry.id)),
            ),
          ),
        )
      }
    }
  }
  if (unchanged.length > 0) {
    details.push(t('users.roleChanged.unchanged', { users: namesText(t, unchanged.map(nameOf)), role: roleName }))
  }

  const title =
    changed.length > 0
      ? t('users.roleChanged.title', { n: changed.length }, changed.length)
      : t('users.roleChanged.none')
  const tone = skipped.length > 0 ? 'warning' : changed.length > 0 ? 'success' : 'info'
  return { tone, title, details }
}

/**
 * The text for a refusal of the whole request (`PUT /users/roles`): 400 `unknown_role` and 403 `forbidden_role`. Any other error
 * is not about roles: it returns undefined and the caller uses the general text for API errors.
 */
export function roleChangeErrorText(code: string | undefined, t: MessageT): string | undefined {
  switch (code) {
    case 'unknown_role':
      return t('users.roleError.unknownRole')
    case 'forbidden_role':
      return t('users.roleError.forbiddenRole')
    default:
      return undefined
  }
}

/** The accounts among `ids` that hold the administrator role (demoting them asks for a confirmation). */
export function administratorsAmong(
  rows: readonly { id: string; roles: readonly string[] }[],
  ids: ReadonlySet<string>,
  signedInId: string | undefined,
): string[] {
  return rows
    .filter((row) => ids.has(row.id) && row.id !== signedInId && row.roles.includes('administrator'))
    .map((row) => row.id)
}
