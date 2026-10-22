// The signed-in person's own account: `GET` and `PATCH /me` (K-011). E-mail and password do not change here: the e-mail
// changes through the confirmation link (K-012) and the password through reset or its own route.
import type { Database } from '@toascribe/db'
import { EMPTY_PROFILE, ProfileFields } from '@toascribe/shared'
import type { DisplayNameChoice, MeResponse, SessionAccount, UpdateMeRequest } from '@toascribe/shared'

import type { SessionAuth } from '../lib/auth-context.ts'
import { AppError } from '../lib/errors.ts'
import { updateProfile } from '../repositories/accounts.ts'

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
  }
}

/** The profile stored in `account.profile`, filled in where it is missing or does not fit the schema. */
export function readProfile(stored: unknown): ProfileFields {
  const parsed = ProfileFields.partial().safeParse(stored)
  return mergeProfile(EMPTY_PROFILE, parsed.success ? parsed.data : {})
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
  get: (auth: SessionAuth) => MeResponse
  update: (auth: SessionAuth, changes: UpdateMeRequest) => Promise<MeResponse>
}

export function createMeService(options: { readonly db: Database; readonly clock: () => Date }): MeService {
  const { db, clock } = options
  return {
    get(auth) {
      return { ...toSessionAccount(auth), profile: readProfile(auth.account.profile) }
    },

    async update(auth, changes) {
      const current = readProfile(auth.account.profile)
      const next = mergeProfile(current, changes)
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
      await updateProfile(db, auth.account.id, displayName, next, clock())
      return { ...toSessionAccount(auth), displayName, profile: next }
    },
  }
}
