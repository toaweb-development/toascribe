// The signed-in person's own account: `GET` and `PATCH /me` (K-011). E-mail and password do not change here: the e-mail
// changes through the confirmation link (K-012) and the password through reset or its own route.
import type { Database } from '@toascribe/db'
import { DEFAULT_PREFERENCES, EMPTY_PROFILE, Preferences, ProfileFields } from '@toascribe/shared'
import type { ListScreenOptions } from '@toascribe/shared'
import type {
  DisplayNameChoice,
  MeResponse,
  SessionAccount,
  UpdateMeRequest,
  UpdatePreferencesRequest,
} from '@toascribe/shared'

import type { SessionAuth } from '../lib/auth-context.ts'
import { avatarUrls, isPublicImage } from './avatars.ts'
import type { MediaService } from './media.ts'
import { AppError } from '../lib/errors.ts'
import { findPendingEmailChange } from '../repositories/account-tokens.ts'
import { mergePreferences, updateLocale, updateProfile } from '../repositories/accounts.ts'
import { inTransaction } from '../repositories/executor.ts'
import { recordInvalidation } from '../repositories/public.ts'

/** Profile fields that may be absent or undefined: what a parsed partial schema gives. */
type ProfileChanges = { readonly [K in keyof ProfileFields]?: ProfileFields[K] | undefined }

/** `base` with the fields of `changes` that are set. A field left out keeps its value; an empty string is a value. */
export function mergeProfile(base: ProfileFields, changes: ProfileChanges): ProfileFields {
  return {
    firstName: changes.firstName ?? base.firstName,
    lastName: changes.lastName ?? base.lastName,
    nickname: changes.nickname ?? base.nickname,
    website: changes.website ?? base.website,
    bio: changes.bio ?? base.bio,
    displayNameChoice: changes.displayNameChoice ?? base.displayNameChoice,
    avatarId: changes.avatarId === undefined ? base.avatarId : changes.avatarId,
  }
}

/** The profile stored in `account.profile`, filled in where it is missing or does not fit the schema. */
export function readProfile(stored: unknown): ProfileFields {
  const parsed = ProfileFields.partial().safeParse(stored)
  return mergeProfile(EMPTY_PROFILE, parsed.success ? parsed.data : {})
}

/**
 * The preferences stored in `account.preferences`, with the default for every key that is missing or does not fit its schema.
 * Each key is read on its own, so one bad value does not reset the others, and keys this version does not know are left out.
 */
export function readPreferences(stored: unknown): Preferences {
  const source: Record<string, unknown> = typeof stored === 'object' && stored !== null ? { ...stored } : {}
  const field = Preferences.shape
  return {
    adminColorScheme: field.adminColorScheme
      .catch(DEFAULT_PREFERENCES.adminColorScheme)
      .parse(source['adminColorScheme']),
    showToolbarOnSite: field.showToolbarOnSite
      .catch(DEFAULT_PREFERENCES.showToolbarOnSite)
      .parse(source['showToolbarOnSite']),
    dismissedWelcome: field.dismissedWelcome
      .catch(DEFAULT_PREFERENCES.dismissedWelcome)
      .parse(source['dismissedWelcome']),
    postsScreen: field.postsScreen.catch(DEFAULT_PREFERENCES.postsScreen).parse(source['postsScreen']),
    pagesScreen: field.pagesScreen.catch(DEFAULT_PREFERENCES.pagesScreen).parse(source['pagesScreen']),
  }
}

/** The name shown publicly, built from the part of the profile the person chose. Empty when that part is empty. */
export function buildDisplayName(username: string, profile: ProfileFields): string {
  const first = profile.firstName.trim()
  const last = profile.lastName.trim()
  const choices: Record<DisplayNameChoice, string> = {
    username,
    first_name: first,
    last_name: last,
    first_last: `${first} ${last}`.trim(),
    last_first: `${last} ${first}`.trim(),
    nickname: profile.nickname.trim(),
  }
  return choices[profile.displayNameChoice]
}

export function toSessionAccount(auth: SessionAuth): SessionAccount {
  return {
    id: auth.account.id,
    username: auth.account.username,
    email: auth.account.email,
    displayName: auth.account.displayName,
    locale: auth.account.locale,
    roles: [...auth.roles],
    capabilities: [...auth.capabilities].sort(),
  }
}

export interface MeService {
  get: (auth: SessionAuth) => Promise<MeResponse>
  update: (auth: SessionAuth, changes: UpdateMeRequest) => Promise<MeResponse>
  /** Saves the preferences that were sent, keeps the rest, and returns all of them. */
  updatePreferences: (auth: SessionAuth, changes: UpdatePreferencesRequest) => Promise<Preferences>
}

export function createMeService(options: {
  readonly db: Database
  readonly clock: () => Date
  readonly media: Pick<MediaService, 'contentRefs'>
  readonly onInvalidSetting?: (key: string) => void
}): MeService {
  const { db, clock } = options

  async function avatarOf(auth: SessionAuth, avatarId: string | null): Promise<string | null> {
    const urls = await avatarUrls(
      db,
      options.media,
      [{ id: auth.account.id, email: auth.account.email, avatarId }],
      options.onInvalidSetting,
    )
    return urls.get(auth.account.id) ?? null
  }

  /** The e-mail change this account has asked for and not confirmed, as /me shows it. */
  async function pendingEmailOf(accountId: string): Promise<MeResponse['pendingEmail']> {
    const pending = await findPendingEmailChange(db, accountId, clock())
    return pending === undefined ? null : { email: pending.email, expiresAt: pending.expiresAt.toISOString() }
  }

  return {
    async get(auth) {
      const profile = readProfile(auth.account.profile)
      return {
        ...toSessionAccount(auth),
        profile,
        avatarUrl: await avatarOf(auth, profile.avatarId),
        preferences: readPreferences(auth.account.preferences),
        pendingEmail: await pendingEmailOf(auth.account.id),
      }
    },

    async update(auth, changes) {
      const current = readProfile(auth.account.profile)
      const next = mergeProfile(current, changes)
      // A profile picture is an image anyone may see: it is shown on the site and to every other account.
      if (
        changes.avatarId !== undefined &&
        changes.avatarId !== null &&
        !(await isPublicImage(options.media, changes.avatarId))
      ) {
        throw new AppError(
          400,
          'invalid_media',
          'The profile picture must be an image in the media library that anyone may see',
        )
      }
      const touchesName =
        changes.firstName !== undefined ||
        changes.lastName !== undefined ||
        changes.nickname !== undefined ||
        changes.displayNameChoice !== undefined
      let displayName = auth.account.displayName
      if (touchesName) {
        displayName = buildDisplayName(auth.account.username, next)
        if (displayName === '') {
          throw new AppError(
            400,
            'validation_error',
            'Invalid request: displayNameChoice (the name it points to is empty)',
          )
        }
      }
      const locale = changes.locale === undefined ? auth.account.locale : changes.locale
      await inTransaction(db, async (tx) => {
        await updateProfile(tx, auth.account.id, displayName, next, clock())
        if (changes.locale !== undefined) await updateLocale(tx, auth.account.id, changes.locale, clock())
        // The site shows authors' names on every post and list, and their pictures on their pages: a new name or picture clears
        // everything (a removed picture must not linger in the site's cache).
        if (displayName !== auth.account.displayName || next.avatarId !== current.avatarId) {
          await recordInvalidation(tx, ['*'], clock())
        }
      })
      return {
        ...toSessionAccount(auth),
        displayName,
        locale,
        profile: next,
        avatarUrl: await avatarOf(auth, next.avatarId),
        preferences: readPreferences(auth.account.preferences),
        pendingEmail: await pendingEmailOf(auth.account.id),
      }
    },

    async updatePreferences(auth, changes) {
      // Only the keys that were sent: a parsed partial may carry `undefined` for the others.
      const sent: Record<string, boolean | string | ListScreenOptions> = {}
      if (changes.adminColorScheme !== undefined) {
        sent['adminColorScheme'] = changes.adminColorScheme
      }
      if (changes.showToolbarOnSite !== undefined) {
        sent['showToolbarOnSite'] = changes.showToolbarOnSite
      }
      if (changes.dismissedWelcome !== undefined) {
        sent['dismissedWelcome'] = changes.dismissedWelcome
      }
      if (changes.postsScreen !== undefined) {
        sent['postsScreen'] = changes.postsScreen
      }
      if (changes.pagesScreen !== undefined) {
        sent['pagesScreen'] = changes.pagesScreen
      }
      const stored = await mergePreferences(db, auth.account.id, sent, clock())
      return readPreferences(stored)
    },
  }
}
