import { EmailChangeRequest, ProfileFields } from '@toascribe/shared'
import type { DisplayNameChoice, MeResponse, UpdateMeRequest } from '@toascribe/shared'

import type { FieldError, KeyTranslator } from './auth-validate.ts'

// The profile form (WordPress' profile.php): the state it holds, the options of «Vis navn offentlig som», the check before it is
// sent and what is sent. The shared schemas are the rules; this file only maps them to fields and to messages.

/** What the form holds. The e-mail address is here although the API changes it through its own call (a confirmation link). */
export interface ProfileFormState {
  firstName: string
  lastName: string
  nickname: string
  displayNameChoice: DisplayNameChoice
  email: string
  website: string
  bio: string
}

/** The fields that the main button saves with `PATCH /me`. */
export const PROFILE_FIELDS = ['firstName', 'lastName', 'nickname', 'displayNameChoice', 'website', 'bio'] as const

/**
 * The form for an account. A nickname is required, and an account that never saved one has none: it starts as the username, as
 * on WordPress, so the form can be sent as it stands.
 */
export function profileFormFrom(me: MeResponse): ProfileFormState {
  return {
    firstName: me.profile.firstName,
    lastName: me.profile.lastName,
    nickname: me.profile.nickname.trim() === '' ? me.username : me.profile.nickname,
    displayNameChoice: me.profile.displayNameChoice,
    email: me.email,
    website: me.profile.website,
    bio: me.profile.bio,
  }
}

type NameParts = Pick<ProfileFormState, 'firstName' | 'lastName' | 'nickname'>

/** The name each choice gives, from the values in the form. The API builds it the same way (`buildDisplayName`). */
export function displayNameFor(username: string, parts: NameParts): Record<DisplayNameChoice, string> {
  const first = parts.firstName.trim()
  const last = parts.lastName.trim()
  return {
    username,
    first_name: first,
    last_name: last,
    first_last: `${first} ${last}`.trim(),
    last_first: `${last} ${first}`.trim(),
    nickname: parts.nickname.trim(),
  }
}

export interface DisplayNameOption {
  value: DisplayNameChoice
  label: string
}

/** WordPress lists nickname and username first, then the names. */
const OPTION_ORDER: readonly DisplayNameChoice[] = [
  'nickname',
  'username',
  'first_name',
  'last_name',
  'first_last',
  'last_first',
]

/**
 * The options of «Vis navn offentlig som», built from what is typed in the form, as WordPress does it: each choice is shown as the
 * name it would give. A choice whose name is empty is left out, and so is a second choice that gives the same text as an earlier
 * one (the nickname often equals the username); the selected choice always stays, so the select never shows something that is not
 * what is saved.
 */
export function displayNameOptions(username: string, state: ProfileFormState): DisplayNameOption[] {
  const names = displayNameFor(username, state)
  const selected = effectiveDisplayNameChoice(username, state)
  const taken = new Map<string, DisplayNameChoice>()
  for (const choice of OPTION_ORDER) {
    const text = names[choice]
    if (text === '' || (taken.has(text) && choice !== selected)) {
      continue
    }
    // The selected choice takes the place of an earlier one with the same text.
    if (!taken.has(text) || choice === selected) {
      taken.set(text, choice)
    }
  }
  return OPTION_ORDER.flatMap((choice) =>
    taken.get(names[choice]) === choice ? [{ value: choice, label: names[choice] }] : [],
  )
}

/** The choice that is saved: the selected one, or the username when the selected one would give an empty name (the API refuses that). */
export function effectiveDisplayNameChoice(username: string, state: ProfileFormState): DisplayNameChoice {
  return displayNameFor(username, state)[state.displayNameChoice] === '' ? 'username' : state.displayNameChoice
}

/**
 * What is wrong with the form, by field, in the order the fields are on the page (the order of the error summary). The rules are
 * the shared schemas'; a nickname is required here because the public name is built from it.
 */
export function validateProfile(state: ProfileFormState, t: KeyTranslator): FieldError[] {
  const errors: FieldError[] = []
  const one = (name: keyof ProfileFormState, ok: boolean, message: () => string) => {
    if (!ok) {
      errors.push({ name, message: message() })
    }
  }
  one('firstName', ProfileFields.shape.firstName.safeParse(state.firstName.trim()).success, () =>
    t('profile.validation.firstName'),
  )
  one('lastName', ProfileFields.shape.lastName.safeParse(state.lastName.trim()).success, () =>
    t('profile.validation.lastName'),
  )
  const nickname = state.nickname.trim()
  one('nickname', nickname !== '' && ProfileFields.shape.nickname.safeParse(nickname).success, () =>
    nickname === '' ? t('profile.validation.nicknameRequired') : t('profile.validation.nickname'),
  )
  const email = state.email.trim()
  one('email', EmailChangeRequest.shape.newEmail.safeParse(email).success, () =>
    email === '' ? t('profile.validation.emailRequired') : t('profile.validation.email'),
  )
  one('website', ProfileFields.shape.website.safeParse(state.website.trim()).success, () =>
    t('profile.validation.website'),
  )
  one('bio', ProfileFields.shape.bio.safeParse(state.bio).success, () => t('profile.validation.bio'))
  return errors
}

/** The body of `PATCH /me`: every profile field, trimmed (the biography keeps its line breaks), the display-name choice that works. */
export function profileChanges(username: string, state: ProfileFormState): Required<Omit<UpdateMeRequest, 'avatarId'>> {
  return {
    firstName: state.firstName.trim(),
    lastName: state.lastName.trim(),
    nickname: state.nickname.trim(),
    displayNameChoice: effectiveDisplayNameChoice(username, state),
    website: state.website.trim(),
    bio: state.bio.trim(),
  }
}

/** True when the form differs from `baseline` in any field, as saved (trimmed). The e-mail address counts: it is asked for on save. */
export function isProfileChanged(username: string, state: ProfileFormState, baseline: ProfileFormState): boolean {
  const now = profileChanges(username, state)
  const before = profileChanges(username, baseline)
  return PROFILE_FIELDS.some((field) => now[field] !== before[field]) || state.email.trim() !== baseline.email.trim()
}
