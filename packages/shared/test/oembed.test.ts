// The oEmbed providers (M1.6, K-225), on stored answers of each (test/fixtures/oembed, the shape of their live answers on
// 2026-10-27), never on the network: which addresses are whose, and that only a player on the provider's own hosts comes out of
// an answer, whatever else the answer holds.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  EMBED_FRAME_HOSTS,
  EmbedProvider,
  InstanceHost,
  OEmbedAnswer,
  embedEndpoint,
  embedFrameOf,
  embedProviderOf,
  embedSize,
  isEmbedFrame,
} from '../src/index.ts'

const DIR = join(import.meta.dirname, 'fixtures', 'oembed')
const MASTODON = ['mastodon.social']

interface Fixture {
  readonly url: string
  readonly answer: unknown
  readonly frame: string
}

const fixtures = readdirSync(DIR)
  .filter((file) => file.endsWith('.json') && file !== 'hostile.json')
  .map((file) => [file.replace('.json', ''), JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Fixture] as const)

describe('each provider, on its stored answer', () => {
  it.each(fixtures)('%s: the address is its own, and only its player comes out', (name, fixture) => {
    const provider = embedProviderOf(fixture.url, MASTODON)
    expect(provider).toBe(name.replace('-playlist', ''))
    if (provider === undefined) return
    expect(new URL(embedEndpoint(provider, fixture.url)).protocol).toBe('https:')
    const answer = OEmbedAnswer.parse(fixture.answer)
    expect(embedFrameOf(provider, answer, fixture.url)).toBe(fixture.frame)
  })

  it('covers every provider', () => {
    expect(new Set(fixtures.map(([name]) => name.replace('-playlist', '')))).toEqual(new Set(EmbedProvider.options))
  })
})

describe('addresses', () => {
  it.each([
    ['https://youtu.be/dQw4w9WgXcQ', 'youtube'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'youtube'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube'],
    ['https://vimeo.com/channels/staffpicks/76979871', 'vimeo'],
    ['https://open.spotify.com/intl-de/album/4aawyAB9vmqN3uQ7FjRGTy', 'spotify'],
    ['https://on.soundcloud.com/abc123', 'soundcloud'],
  ])('%s is %s', (address, provider) => {
    expect(embedProviderOf(address)).toBe(provider)
  })

  it.each([
    'http://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com.evil.example/watch?v=x',
    'https://evil.example/@Gargron/1',
    'https://user@www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ',
    'javascript:alert(1)',
    'https://mastodon.social/@Gargron/109310283456108235',
    'not an address',
  ])('%s has no provider (a Mastodon instance only when it is listed)', (address) => {
    expect(embedProviderOf(address)).toBeUndefined()
  })

  it('takes an instance host in the list form only', () => {
    expect(InstanceHost.parse('  Mastodon.Social ')).toBe('mastodon.social')
    for (const bad of ['https://mastodon.social', 'mastodon.social/', 'localhost', '10.0.0.1', 'a b.no']) {
      expect(InstanceHost.safeParse(bad).success, bad).toBe(false)
    }
  })
})

describe('a hostile answer', () => {
  const { cases } = JSON.parse(readFileSync(join(DIR, 'hostile.json'), 'utf8')) as {
    cases: { provider: EmbedProvider; url: string; html: string }[]
  }

  it.each(cases)('$provider: nothing comes out of $html', ({ provider, url, html }) => {
    expect(embedFrameOf(provider, { type: 'rich', html }, url)).toBeUndefined()
  })

  it('checks a stored address again as the site does', () => {
    expect(isEmbedFrame('youtube', 'https://www.youtube.com/embed/dQw4w9WgXcQ', '')).toBe(false)
    expect(isEmbedFrame('youtube', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', '')).toBe(true)
    expect(isEmbedFrame('mastodon', 'https://mastodon.social/@a/1/embed', 'https://other.example/@a/1')).toBe(false)
    expect(isEmbedFrame('vimeo', 'https://player.vimeo.com/video/1#x', '')).toBe(false)
  })

  it('lists no wildcard among the player hosts', () => {
    for (const hosts of Object.values(EMBED_FRAME_HOSTS))
      for (const host of hosts) expect(host).toMatch(/^[a-z0-9.-]+$/)
  })
})

describe('embedSize', () => {
  it('takes whole pixels only', () => {
    expect(embedSize(360)).toBe(360)
    expect(embedSize('640')).toBe(640)
    expect(embedSize('100%')).toBeNull()
    expect(embedSize(null)).toBeNull()
    expect(embedSize(99_999)).toBeNull()
  })
})
