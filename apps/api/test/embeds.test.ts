// «Innbygging» on save (M1.6, K-225): the server sets each embed block from its address, on stored answers of every provider
// (packages/shared/test/fixtures/oembed, never the network); what the editor sends is not believed; an unknown address, a hostile
// answer and an address the server may not reach (SSRF: a private address, a redirect to one) leave a plain link; the thumbnail
// goes to the media library; the editor's preview; the cap per save.
import { readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { join } from 'node:path'

import { createBlock } from '@toascribe/blocks'
import { createSafeFetch } from '@toascribe/http'
import type { SafeResponse } from '@toascribe/http'
import { ContentItem, EmbedPreviewResponse } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { setSetting } from './flows.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp, TestClient } from './harness.ts'
import * as f from './media-fixtures.ts'
import type { EmbedFetch } from '../src/services/embeds.ts'
import { MAX_EMBEDS_PER_SAVE } from '../src/services/embeds.ts'

noticeIfSkipped('embeds')

const DIR = join(import.meta.dirname, '../../../packages/shared/test/fixtures/oembed')
interface Fixture {
  readonly url: string
  readonly answer: { html?: string; thumbnail_url?: string }
  readonly frame: string
}
const FIXTURES = readdirSync(DIR)
  .filter((file) => file.endsWith('.json') && file !== 'hostile.json')
  .map((file) => [file.replace('.json', ''), JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Fixture] as const)

function answer(url: string, status: number, body: Uint8Array | string): SafeResponse {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body
  return {
    status,
    statusText: '',
    headers: new Headers(),
    url,
    redirected: false,
    body: bytes,
    text: () => new TextDecoder().decode(bytes),
  }
}

/** The stored answers: an endpoint asked for a fixture's address gets its answer; a thumbnail address gets a PNG. */
const asked: string[] = []
let hostile: string | undefined
const storedAnswers: EmbedFetch = (url) => {
  asked.push(url)
  const endpoint = new URL(url)
  const content = endpoint.searchParams.get('url')
  const fixture = FIXTURES.find(([, entry]) => entry.url === content)?.[1]
  if (fixture !== undefined) {
    const body = hostile === undefined ? fixture.answer : { ...fixture.answer, html: hostile }
    return Promise.resolve(answer(url, 200, JSON.stringify(body)))
  }
  if (FIXTURES.some(([, entry]) => entry.answer.thumbnail_url === url)) return Promise.resolve(answer(url, 200, f.PNG))
  return Promise.resolve(answer(url, 404, ''))
}

const embed = (url: string, attrs: Record<string, unknown> = {}) => createBlock('core/embed', { url, ...attrs })

describe.skipIf(TEST_DATABASE_URL === undefined)('«Innbygging» on save (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let admin: TestClient
  let contributor: TestClient
  let subscriber: TestClient

  async function save(client: TestClient, blocks: unknown[]): Promise<ContentItem> {
    const res = await client.post('/api/v1/content', { type: 'post', title: 'Med innbygging', blocks })
    expect(res.status, await res.clone().text()).toBe(201)
    return ContentItem.parse(await res.json())
  }
  const attrsOf = (item: ContentItem, index = 0) => (item.blocks[index] as { attrs: Record<string, unknown> }).attrs

  beforeAll(async () => {
    env = await startAuthApp({ embedFetch: (url, options) => storedAnswers(url, options) })
    await env.createAccount({ username: 'emb-admin', role: 'administrator' })
    await env.createAccount({ username: 'emb-contributor', role: 'contributor' })
    await env.createAccount({ username: 'emb-subscriber', role: 'subscriber' })
    admin = env.client({ ip: '203.0.113.91' })
    contributor = env.client({ ip: '203.0.113.92' })
    subscriber = env.client({ ip: '203.0.113.93' })
    expect((await admin.login('emb-admin', TEST_PASSWORD)).status).toBe(200)
    expect((await contributor.login('emb-contributor', TEST_PASSWORD)).status).toBe(200)
    expect((await subscriber.login('emb-subscriber', TEST_PASSWORD)).status).toBe(200)
    await setSetting(env, 'oembed_mastodon_instances', ['mastodon.social'])
  })

  afterAll(async () => {
    await env.close()
  })

  it.each(FIXTURES)(
    '%s: the server sets the player, the title and a thumbnail from the stored answer',
    async (_name, fixture) => {
      const item = await save(admin, [embed(fixture.url)])
      const attrs = attrsOf(item)
      expect(attrs['frameSrc']).toBe(fixture.frame)
      expect(attrs['provider']).not.toBe('')
      if (fixture.answer.thumbnail_url === undefined) {
        expect(attrs['thumbnailId']).toBe('')
      } else {
        expect(attrs['thumbnailId']).toMatch(/^[0-9a-f-]{36}$/)
        expect(item.media.map((ref) => ref.id)).toContain(attrs['thumbnailId'])
      }
    },
  )

  it('does not believe what the editor sends: an unknown address stays a link', async () => {
    const item = await save(admin, [
      embed('https://example.com/side', {
        provider: 'youtube',
        frameSrc: 'https://evil.example/embed/x',
        title: 'Ond',
        thumbnailId: crypto.randomUUID(),
      }),
    ])
    expect(attrsOf(item)).toMatchObject({ provider: '', frameSrc: '', title: '', thumbnailId: '' })
  })

  it('leaves a link for a hostile answer, with nothing of its HTML kept', async () => {
    hostile = '<iframe src="https://evil.example/embed/x"></iframe><script>alert(1)</script>'
    try {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1'
      // A new address, so the stored answer (kept a day) is not used.
      const item = await save(admin, [embed(url)])
      expect(attrsOf(item)).toMatchObject({ provider: '', frameSrc: '' })
      expect(JSON.stringify(item.blocks)).not.toContain('evil.example')
    } finally {
      hostile = undefined
    }
  })

  it('reads at most a fixed number of embeds in one save; the rest are links', async () => {
    const before = asked.length
    const many = Array.from({ length: MAX_EMBEDS_PER_SAVE + 5 }, (_, index) =>
      embed(`https://vimeo.com/${String(1000 + index)}`),
    )
    await save(admin, many)
    expect(asked.length - before).toBeLessThanOrEqual(MAX_EMBEDS_PER_SAVE)
  })

  it('stores no thumbnail for an account that may not upload, and keeps the player', async () => {
    const item = await save(contributor, [embed('https://www.youtube.com/shorts/dQw4w9WgXcQ')])
    expect(attrsOf(item)['thumbnailId']).toBe('')
  })

  it('previews an address for the editor, and refuses one who may not write', async () => {
    const res = await admin.post('/api/v1/oembed/preview', { url: 'https://vimeo.com/76979871' })
    expect(res.status).toBe(200)
    expect(EmbedPreviewResponse.parse(await res.json())).toMatchObject({
      provider: 'vimeo',
      frameSrc: 'https://player.vimeo.com/video/76979871',
    })
    const unknown = EmbedPreviewResponse.parse(
      await (await admin.post('/api/v1/oembed/preview', { url: 'javascript:alert(1)' })).json(),
    )
    expect(unknown.provider).toBeNull()
    expect((await subscriber.post('/api/v1/oembed/preview', { url: 'https://vimeo.com/76979871' })).status).toBe(403)
  })
})

describe.skipIf(TEST_DATABASE_URL === undefined)('«Innbygging» and SSRF (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let admin: TestClient
  let server: Server
  let port = 0
  const reached: string[] = []

  beforeAll(async () => {
    // A server on this machine that sends every request on to a private address.
    server = createServer((req, res) => {
      reached.push(req.url ?? '')
      res.writeHead(302, { location: `http://intern.test:${String(port)}/hemmelig` })
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    port = typeof address === 'object' && address !== null ? address.port : 0
    // The real client, with names looked up here: the provider's host is this machine (allowed for the test); `intern.test` and
    // `privat.test` are private addresses, which it must refuse.
    const client = createSafeFetch({
      resolve: (hostname) =>
        Promise.resolve(
          hostname === 'offentlig.test'
            ? [{ address: '127.0.0.1', family: 4 }]
            : [{ address: hostname === 'privat.test' ? '10.0.0.5' : '192.168.1.10', family: 4 }],
        ),
      isAllowed: (address) => address === '127.0.0.1',
    })
    // The endpoint the service asks is sent to the test host: the redirect test through this machine, the other straight to a
    // private address.
    const ssrf: EmbedFetch = (url, options) => {
      const viaRedirect = new URL(url).hostname === 'www.youtube.com'
      const target = viaRedirect
        ? `http://offentlig.test:${String(port)}/oembed`
        : `http://privat.test:${String(port)}/oembed`
      return client(target, { ...options, allowedPorts: [port] })
    }
    env = await startAuthApp({ embedFetch: ssrf })
    await env.createAccount({ username: 'ssrf-admin', role: 'administrator' })
    admin = env.client({ ip: '203.0.113.94' })
    expect((await admin.login('ssrf-admin', TEST_PASSWORD)).status).toBe(200)
  })

  afterAll(async () => {
    await env.close()
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  })

  it('never follows a provider to a private address: the embed is a link', async () => {
    for (const url of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://vimeo.com/76979871']) {
      const res = await admin.post('/api/v1/content', { type: 'post', title: 'SSRF', blocks: [embed(url)] })
      expect(res.status, await res.clone().text()).toBe(201)
      const item = ContentItem.parse(await res.json())
      expect((item.blocks[0] as { attrs: Record<string, unknown> }).attrs).toMatchObject({ provider: '', frameSrc: '' })
    }
    // The redirect reached this machine once and went no further; the private host was never asked.
    expect(reached).toEqual(['/oembed'])
  })
})
