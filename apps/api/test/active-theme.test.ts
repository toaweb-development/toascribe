// The site's active theme as the api reads it (services/active-theme.ts): from the site's /_toascribe/theme, kept a minute, null for
// a site without a theme, and a 503 (never an unchecked save) when the site does not answer.
import { describe, expect, it } from 'vitest'

import { SiteUnavailableError, siteThemeSource } from '../src/services/active-theme.ts'
import { TEST_THEME } from './harness.ts'

function source(answers: (() => Response)[]) {
  let time = 0
  const asked: string[] = []
  const theme = siteThemeSource({
    siteUrl: 'http://site:3000',
    now: () => time,
    fetch: (input) => {
      asked.push(input instanceof Request ? input.url : input instanceof URL ? input.href : input)
      const next = answers.shift()
      if (next === undefined) return Promise.reject(new Error('no answer'))
      try {
        return Promise.resolve(next())
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error('failed'))
      }
    },
  })
  return { theme, asked, advance: (ms: number) => (time += ms) }
}

describe('siteThemeSource', () => {
  it('asks the site and keeps the answer for a minute', async () => {
    const { theme, asked, advance } = source([
      () => Response.json(TEST_THEME),
      () => Response.json({ ...TEST_THEME, slug: 'ny' }),
    ])
    expect((await theme.current())?.slug).toBe('default')
    expect((await theme.current())?.slug).toBe('default')
    expect(asked).toEqual(['http://site:3000/_toascribe/theme'])
    advance(61_000)
    expect((await theme.current())?.slug).toBe('ny')
  })

  it('is null for a site without a theme (404)', async () => {
    const { theme } = source([() => new Response('', { status: 404 })])
    expect(await theme.current()).toBeNull()
  })

  it('refuses with 503 when the site is away or answers nonsense, and asks again next time', async () => {
    const { theme } = source([
      () => {
        throw new Error('ECONNREFUSED')
      },
      () => new Response('down', { status: 502 }),
      () => Response.json({ slug: 'NOT A THEME' }),
      () => Response.json(TEST_THEME),
    ])
    for (let i = 0; i < 3; i += 1) await expect(theme.current()).rejects.toBeInstanceOf(SiteUnavailableError)
    expect((await theme.current())?.slug).toBe('default')
  })
})
