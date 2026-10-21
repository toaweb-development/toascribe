import { describe, expect, it } from 'vitest'

import {
  CONTENT_STATUS,
  CONTENT_STATUS_BEFORE_TRASH,
  ContentSeo,
  ContentStatus,
  FocalPoint,
  REDIRECT_STATUS_CODE,
  RedirectStatusCode,
} from '../src/index.ts'

// The lists themselves are checked against the CHECK constraints in packages/db/test/schema.test.ts.
describe('data model value sets and documents', () => {
  it('a value set schema accepts exactly its list', () => {
    for (const status of CONTENT_STATUS) {
      expect(ContentStatus.parse(status)).toBe(status)
    }
    expect(ContentStatus.safeParse('published').success).toBe(false)
    expect(ContentStatus.safeParse('Draft').success).toBe(false)
  })

  it('status_before_trash is every status except trash', () => {
    expect([...CONTENT_STATUS_BEFORE_TRASH, 'trash'].sort()).toEqual([...CONTENT_STATUS].sort())
  })

  it('RedirectStatusCode takes the listed numbers only', () => {
    for (const code of REDIRECT_STATUS_CODE) {
      expect(RedirectStatusCode.parse(code)).toBe(code)
    }
    expect(RedirectStatusCode.safeParse(303).success).toBe(false)
    expect(RedirectStatusCode.safeParse('301').success).toBe(false)
  })

  it('ContentSeo has the four PLAN keys, all optional, with a media id as image', () => {
    expect(ContentSeo.parse({})).toEqual({})
    expect(ContentSeo.safeParse({ image: 'https://example.test/a.jpg' }).success).toBe(false)
    expect(ContentSeo.safeParse({ image: '0199f3a0-0000-7000-8000-000000000000', noindex: true }).success).toBe(true)
  })

  it('FocalPoint is a fraction of the width and height', () => {
    expect(FocalPoint.safeParse({ x: 0.5, y: 0 }).success).toBe(true)
    expect(FocalPoint.safeParse({ x: 1.5, y: 0.5 }).success).toBe(false)
  })
})
