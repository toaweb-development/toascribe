import { describe, expect, it } from 'vitest'

import { WIZARD_STEPS, classifySetupFailure, isAdminStepFailure, stepFor, stepIndex } from '../app/utils/setup-flow.ts'

describe('the steps', () => {
  it('are the seven of the specification, in order', () => {
    expect(WIZARD_STEPS).toEqual(['token', 'check', 'site', 'email', 'admin', 'content', 'finish'])
  })

  it('start a reload at the first step the api has not saved', () => {
    expect(stepFor('check')).toBe(1)
    expect(stepFor('site')).toBe(2)
    expect(stepFor('email')).toBe(3)
    expect(stepFor('admin')).toBe(4)
    expect(stepIndex('finish')).toBe(6)
  })
})

describe('classifySetupFailure', () => {
  it('takes a 404 and an already_installed for an installed site', () => {
    expect(classifySetupFailure({ status: 404, code: 'not_found' })).toEqual({ kind: 'installed' })
    expect(classifySetupFailure({ status: 409, code: 'already_installed' })).toEqual({ kind: 'installed' })
  })
  it('takes a missing or wrong code for a lost code, but not other 401s', () => {
    expect(classifySetupFailure({ status: 401, code: 'invalid_setup_token' })).toEqual({ kind: 'token' })
    expect(classifySetupFailure({ status: 401, code: 'setup_token_required' })).toEqual({ kind: 'token' })
    expect(classifySetupFailure({ status: 401, code: 'unauthorized' })).toEqual({ kind: 'other' })
  })
  it('leaves everything else to the step', () => {
    for (const caught of [
      { status: 429, code: 'too_many_requests' },
      { status: 409, code: 'username_taken' },
      { status: undefined, code: 'network' },
      new Error('boom'),
      'text',
      null,
    ]) {
      expect(classifySetupFailure(caught)).toEqual({ kind: 'other' })
    }
  })
})

describe('isAdminStepFailure', () => {
  it('is true for what the administrator step can fix', () => {
    for (const code of ['username_taken', 'email_taken', 'recovery_key_mismatch']) {
      expect(isAdminStepFailure(code)).toBe(true)
    }
    for (const code of ['step_missing', 'content_exists', 'validation_error']) {
      expect(isAdminStepFailure(code)).toBe(false)
    }
  })
})
