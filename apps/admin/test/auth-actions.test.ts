import { describe, expect, it } from 'vitest'

import { NOTICE_QUERY, allowsSession, loginAction, loginNotice } from '../app/utils/auth-actions.ts'

describe('loginAction', () => {
  it.each([
    ['lostpassword', 'lostpassword'],
    ['retrievepassword', 'lostpassword'],
    ['resetpass', 'resetpass'],
    ['rp', 'resetpass'],
    ['setpassword', 'setpassword'],
    ['confirmemail', 'confirmemail'],
    ['register', 'register'],
    ['logout', 'logout'],
    ['login', 'login'],
  ])('%s is %s', (value, action) => {
    expect(loginAction(value)).toBe(action)
  })

  it.each([undefined, '', 'unknown', 'postpass', ['lostpassword'], 5, 'constructor', '__proto__', 'toString'])(
    'is the login form for %j',
    (value) => {
      expect(loginAction(value)).toBe('login')
    },
  )
})

describe('loginNotice', () => {
  it.each([
    [{ loggedout: 'true' }, 'loggedOut'],
    [{ password: 'changed' }, 'passwordChanged'],
    [{ checkemail: 'confirm' }, 'checkEmail'],
    [{ checkemail: 'registered' }, 'registered'],
  ] as const)('%j shows %s', (query, notice) => {
    expect(loginNotice(query)).toBe(notice)
  })

  it('shows nothing for anything else (the notice text is fixed, so a query cannot print its own)', () => {
    expect(loginNotice({})).toBeUndefined()
    expect(loginNotice({ loggedout: 'false' })).toBeUndefined()
    expect(loginNotice({ checkemail: '<b>hi</b>' })).toBeUndefined()
  })

  it('NOTICE_QUERY is what loginNotice reads', () => {
    for (const [notice, query] of Object.entries(NOTICE_QUERY)) {
      expect(loginNotice(query)).toBe(notice)
    }
  })
})

describe('allowsSession', () => {
  it('lets the reset, set-password and confirm links work with a session, and sends a signed-in person away from the rest', () => {
    expect(['resetpass', 'setpassword', 'confirmemail'].every((action) => allowsSession(action as never))).toBe(true)
    expect(['login', 'lostpassword', 'register', 'logout'].some((action) => allowsSession(action as never))).toBe(false)
  })
})
