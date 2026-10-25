import type { AssignRoleResponse } from '@toascribe/shared'
import { describe, expect, it } from 'vitest'

import {
  MAX_NAMES_LISTED,
  administratorsAmong,
  describeRoleChange,
  namesText,
  roleChangeErrorText,
  roleLabel,
  rolesText,
} from '../app/utils/users-messages.ts'
import type { MessageT } from '../app/utils/users-messages.ts'

/** A translator that shows what it was asked for: the key, the named values and the plural number. */
const t: MessageT = (key, named, plural) =>
  [key, ...(named === undefined ? [] : [JSON.stringify(named)]), ...(plural === undefined ? [] : [`#${plural}`])].join(
    ' ',
  )

const A = '01a15f9a-26a2-73d3-8aad-c6b671836b01'
const B = '01a15f9a-26a2-73d3-8aad-c6b671836b02'
const C = '01a15f9a-26a2-73d3-8aad-c6b671836b03'
const D = '01a15f9a-26a2-73d3-8aad-c6b671836b04'
const usernames = new Map([
  [A, 'anna'],
  [B, 'bjorn'],
  [C, 'carl'],
  [D, 'dina'],
])

function response(changes: Partial<AssignRoleResponse> = {}): AssignRoleResponse {
  return { changed: [], unchanged: [], skipped: [], ...changes }
}

describe('role names', () => {
  it('translates the five built-in roles', () => {
    for (const slug of ['administrator', 'editor', 'author', 'contributor', 'subscriber']) {
      expect(roleLabel(t, slug, 'Stored')).toBe(`roles.${slug}`)
    }
  })

  it('shows the stored name of any other role, and the slug when there is none', () => {
    expect(roleLabel(t, 'shop-manager', 'Butikksjef')).toBe('Butikksjef')
    expect(roleLabel(t, 'shop-manager', undefined)).toBe('shop-manager')
  })

  it('lists the roles of an account, or says it has none', () => {
    const nameOf = (slug: string) => (slug === 'shop-manager' ? 'Butikksjef' : undefined)
    expect(rolesText(t, ['editor', 'shop-manager'], nameOf)).toBe('roles.editorusers.roleSeparatorButikksjef')
    expect(rolesText(t, [], nameOf)).toBe('users.noRole')
  })
})

describe('naming accounts', () => {
  it('lists a few and counts the rest', () => {
    expect(namesText(t, ['a', 'b'])).toBe('a, b')
    const many = Array.from({ length: MAX_NAMES_LISTED + 3 }, (_, index) => `u${index}`)
    expect(namesText(t, many)).toBe(`u0, u1, u2, u3, u4 users.nameList.more {"n":3}`)
  })
})

describe('what the screen says after «Endre»', () => {
  const roleName = 'Redaktør'

  it('is a success, with no details, when everyone was changed', () => {
    const report = describeRoleChange({ response: response({ changed: [A, B] }), usernames, roleName }, t)
    expect(report).toEqual({ tone: 'success', title: 'users.roleChanged.title {"n":2} #2', details: [] })
  })

  it('reports those that already had the role briefly and still calls it a success', () => {
    const report = describeRoleChange(
      { response: response({ changed: [A], unchanged: [B, C] }), usernames, roleName },
      t,
    )
    expect(report.tone).toBe('success')
    expect(report.details).toEqual(['users.roleChanged.unchanged {"users":"bjorn, carl","role":"Redaktør"}'])
  })

  it('is information, not success, when nothing needed changing', () => {
    const report = describeRoleChange({ response: response({ unchanged: [A] }), usernames, roleName }, t)
    expect(report.tone).toBe('info')
    expect(report.title).toBe('users.roleChanged.none')
  })

  it('is a warning when anyone was left alone, and says how many and why, one line for each reason', () => {
    const report = describeRoleChange(
      {
        response: response({
          changed: [A],
          skipped: [
            { id: D, reason: 'not_found' },
            { id: B, reason: 'last_administrator' },
            { id: C, reason: 'forbidden_user' },
            { id: A, reason: 'self' },
          ],
        }),
        usernames,
        roleName,
      },
      t,
    )
    expect(report.tone).toBe('warning')
    expect(report.title).toBe('users.roleChanged.title {"n":1} #1')
    expect(report.details).toEqual([
      'users.roleChanged.skippedCount {"n":4} #4',
      'users.roleSkipped.self',
      'users.roleSkipped.lastAdministrator {"users":"bjorn"}',
      'users.roleSkipped.forbiddenUser {"users":"carl"}',
      'users.roleSkipped.notFound {"users":"dina"}',
    ])
  })

  it('names all the accounts of one reason together', () => {
    const report = describeRoleChange(
      {
        response: response({
          skipped: [
            { id: B, reason: 'forbidden_user' },
            { id: C, reason: 'forbidden_user' },
          ],
        }),
        usernames,
        roleName,
      },
      t,
    )
    expect(report.tone).toBe('warning')
    expect(report.title).toBe('users.roleChanged.none')
    expect(report.details).toEqual([
      'users.roleChanged.skippedCount {"n":2} #2',
      'users.roleSkipped.forbiddenUser {"users":"bjorn, carl"}',
    ])
  })

  it('names an account it does not know with a plain word, never with the id', () => {
    const report = describeRoleChange(
      {
        response: response({ skipped: [{ id: '01a15f9a-26a2-73d3-8aad-c6b671836bff', reason: 'not_found' }] }),
        usernames,
        roleName,
      },
      t,
    )
    expect(report.details.join(' ')).toContain('users.unknownUser')
    expect(report.details.join(' ')).not.toContain('6bff')
  })
})

describe('a refusal of the whole request', () => {
  it('has a text for the two role errors and none for anything else', () => {
    expect(roleChangeErrorText('unknown_role', t)).toBe('users.roleError.unknownRole')
    expect(roleChangeErrorText('forbidden_role', t)).toBe('users.roleError.forbiddenRole')
    expect(roleChangeErrorText('forbidden', t)).toBeUndefined()
    expect(roleChangeErrorText(undefined, t)).toBeUndefined()
  })
})

describe('the administrators among the ticked accounts', () => {
  const rows = [
    { id: A, roles: ['administrator'] },
    { id: B, roles: ['editor', 'administrator'] },
    { id: C, roles: ['editor'] },
    { id: D, roles: [] },
  ]

  it('finds those who hold the role, also next to another', () => {
    expect(administratorsAmong(rows, new Set([A, B, C, D]), undefined)).toEqual([A, B])
  })

  it('does not count the signed-in account, which the API leaves alone', () => {
    expect(administratorsAmong(rows, new Set([A, B]), A)).toEqual([B])
  })

  it('counts only the ticked ones', () => {
    expect(administratorsAmong(rows, new Set([C]), undefined)).toEqual([])
  })
})
