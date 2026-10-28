import { describe, expect, it } from 'vitest'

import { describeDevice, formatWhen } from '../app/utils/session-device.ts'

describe('describeDevice', () => {
  it.each([
    ['Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', { browser: 'Firefox', system: 'Linux' }],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
      { browser: 'Chrome', system: 'Windows' },
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
      { browser: 'Edge', system: 'Windows' },
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
      { browser: 'Safari', system: 'macOS' },
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      { browser: 'Safari', system: 'iOS' },
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
      { browser: 'Chrome', system: 'Android' },
    ],
    [
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36',
      { browser: 'Chrome', system: 'Linux' },
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 OPR/114.0.0.0',
      { browser: 'Opera', system: 'Windows' },
    ],
  ])('names the browser and the system in %s', (userAgent, expected) => {
    expect(describeDevice(userAgent)).toEqual(expected)
  })

  it('names what it knows and leaves out the rest', () => {
    expect(describeDevice('curl/8.5.0')).toEqual({ browser: undefined, system: undefined })
    expect(describeDevice(null)).toEqual({ browser: undefined, system: undefined })
    expect(describeDevice('')).toEqual({ browser: undefined, system: undefined })
  })
})

describe('formatWhen', () => {
  it("writes a date and a time in the admin's language", () => {
    const norsk = formatWhen('2026-10-05T12:05:00.000Z', 'nb')
    expect(norsk).toMatch(/2026/)
    expect(norsk).toMatch(/okt/)
    expect(formatWhen('2026-10-05T12:05:00.000Z', 'en')).toMatch(/Oct/)
  })
})
