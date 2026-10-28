import type { MeResponse } from '@toascribe/shared'
import { DEFAULT_PREFERENCES } from '@toascribe/shared'
import { describe, expect, it } from 'vitest'

import {
  displayNameFor,
  displayNameOptions,
  effectiveDisplayNameChoice,
  isProfileChanged,
  profileChanges,
  profileFormFrom,
  validateProfile,
} from '../app/utils/profile-form.ts'
import type { ProfileFormState } from '../app/utils/profile-form.ts'

const t = (key: string) => key

function form(overrides: Partial<ProfileFormState> = {}): ProfileFormState {
  return {
    firstName: '',
    lastName: '',
    nickname: 'alice',
    displayNameChoice: 'username',
    email: 'alice@example.test',
    website: '',
    bio: '',
    ...overrides,
  }
}

function account(profile: Partial<MeResponse['profile']> = {}): MeResponse {
  return {
    id: '01a15f9a-26a2-73d3-8aad-c6b671836b33',
    username: 'alice',
    email: 'alice@example.test',
    displayName: 'alice',
    locale: null,
    roles: ['editor'],
    capabilities: ['read'],
    profile: {
      firstName: '',
      lastName: '',
      nickname: '',
      website: '',
      bio: '',
      displayNameChoice: 'username',
      avatarId: null,
      ...profile,
    },
    avatarUrl: null,
    preferences: DEFAULT_PREFERENCES,
    pendingEmail: null,
  }
}

describe('displayNameFor', () => {
  it('builds each choice from the name parts, as the API does', () => {
    expect(displayNameFor('alice', { firstName: ' Ada ', lastName: 'Lovelace', nickname: 'Countess' })).toEqual({
      username: 'alice',
      first_name: 'Ada',
      last_name: 'Lovelace',
      first_last: 'Ada Lovelace',
      last_first: 'Lovelace Ada',
      nickname: 'Countess',
    })
  })

  it('gives one name when the other is empty, and nothing when both are', () => {
    const names = displayNameFor('alice', { firstName: 'Ada', lastName: '', nickname: '' })
    expect(names.first_last).toBe('Ada')
    expect(names.last_first).toBe('Ada')
    expect(names.last_name).toBe('')
    expect(names.nickname).toBe('')
  })
})

describe('displayNameOptions', () => {
  it('lists nickname and username first, then the names, each shown as the name it gives', () => {
    const options = displayNameOptions(
      'alice',
      form({ firstName: 'Ada', lastName: 'Lovelace', nickname: 'Countess', displayNameChoice: 'first_last' }),
    )
    expect(options).toEqual([
      { value: 'nickname', label: 'Countess' },
      { value: 'username', label: 'alice' },
      { value: 'first_name', label: 'Ada' },
      { value: 'last_name', label: 'Lovelace' },
      { value: 'first_last', label: 'Ada Lovelace' },
      { value: 'last_first', label: 'Lovelace Ada' },
    ])
  })

  it('leaves out choices that would give an empty name', () => {
    const options = displayNameOptions('alice', form({ nickname: '', firstName: 'Ada' }))
    // No nickname, so the username is first; with only a first name «first last» and «last first» repeat «first».
    expect(options.map((option) => option.value)).toEqual(['username', 'first_name'])
  })

  it('leaves out a second choice with the same text as an earlier one', () => {
    // The nickname is the username, and with only a first name «first last» and «last first» repeat «first».
    const options = displayNameOptions('alice', form({ firstName: 'Ada', displayNameChoice: 'nickname' }))
    expect(options.map((option) => option.value)).toEqual(['nickname', 'first_name'])
    expect(options.map((option) => option.label)).toEqual(['alice', 'Ada'])
  })

  it('keeps the selected choice even when an earlier one has the same text', () => {
    const options = displayNameOptions('alice', form({ displayNameChoice: 'username' }))
    expect(options).toEqual([{ value: 'username', label: 'alice' }])
    const first = displayNameOptions('alice', form({ firstName: 'Ada', displayNameChoice: 'first_last' }))
    expect(first.find((option) => option.value === 'first_last')?.label).toBe('Ada')
    expect(first.some((option) => option.value === 'first_name')).toBe(false)
  })

  it('always contains the choice that is saved', () => {
    for (const choice of ['username', 'nickname', 'first_name', 'last_name', 'first_last', 'last_first'] as const) {
      const state = form({ firstName: 'Ada', lastName: 'Lovelace', nickname: 'alice', displayNameChoice: choice })
      const effective = effectiveDisplayNameChoice('alice', state)
      expect(displayNameOptions('alice', state).map((option) => option.value)).toContain(effective)
    }
  })
})

describe('effectiveDisplayNameChoice', () => {
  it('falls back to the username when the chosen name would be empty (the API refuses an empty name)', () => {
    expect(effectiveDisplayNameChoice('alice', form({ firstName: '', displayNameChoice: 'first_name' }))).toBe(
      'username',
    )
    expect(effectiveDisplayNameChoice('alice', form({ firstName: 'Ada', displayNameChoice: 'first_name' }))).toBe(
      'first_name',
    )
  })
})

describe('profileFormFrom', () => {
  it('starts an empty nickname as the username, so the form can be sent as it stands', () => {
    expect(profileFormFrom(account()).nickname).toBe('alice')
    expect(profileFormFrom(account({ nickname: 'Countess' })).nickname).toBe('Countess')
  })
})

describe('validateProfile', () => {
  it('accepts a form of an account that never saved a profile', () => {
    expect(validateProfile(profileFormFrom(account()), t)).toEqual([])
  })

  it('names the fields that are wrong, in the order of the page', () => {
    const errors = validateProfile(
      form({
        firstName: 'x'.repeat(101),
        nickname: '   ',
        email: 'not an address',
        website: 'example.org',
        bio: 'y'.repeat(5001),
      }),
      t,
    )
    expect(errors.map((error) => error.name)).toEqual(['firstName', 'nickname', 'email', 'website', 'bio'])
    expect(errors.find((error) => error.name === 'nickname')?.message).toBe('profile.validation.nicknameRequired')
  })

  it('refuses a website that is not http or https, and an address with line breaks in a name', () => {
    expect(validateProfile(form({ website: 'javascript:alert(1)' }), t).map((error) => error.name)).toEqual(['website'])
    expect(validateProfile(form({ lastName: 'a\nb' }), t).map((error) => error.name)).toEqual(['lastName'])
    expect(validateProfile(form({ website: 'https://example.org/ada' }), t)).toEqual([])
  })

  it('asks for an e-mail address', () => {
    expect(validateProfile(form({ email: '' }), t)[0]?.message).toBe('profile.validation.emailRequired')
  })

  it('lets the biography keep its line breaks', () => {
    expect(validateProfile(form({ bio: 'one\ntwo\r\nthree\tfour' }), t)).toEqual([])
  })
})

describe('profileChanges and isProfileChanged', () => {
  it('sends every profile field trimmed, and the choice that works', () => {
    expect(
      profileChanges(
        'alice',
        form({ firstName: ' Ada ', nickname: ' Countess ', bio: ' hi \n', displayNameChoice: 'last_name' }),
      ),
    ).toEqual({
      firstName: 'Ada',
      lastName: '',
      nickname: 'Countess',
      displayNameChoice: 'username',
      website: '',
      bio: 'hi',
    })
  })

  it('is unchanged for the form as loaded, and for a change of spacing only', () => {
    const baseline = profileFormFrom(account({ firstName: 'Ada' }))
    expect(isProfileChanged('alice', { ...baseline }, baseline)).toBe(false)
    expect(isProfileChanged('alice', { ...baseline, firstName: ' Ada ' }, baseline)).toBe(false)
  })

  it('is changed by a field, and by the e-mail address', () => {
    const baseline = profileFormFrom(account())
    expect(isProfileChanged('alice', { ...baseline, bio: 'Hello' }, baseline)).toBe(true)
    expect(isProfileChanged('alice', { ...baseline, email: 'new@example.test' }, baseline)).toBe(true)
  })
})
