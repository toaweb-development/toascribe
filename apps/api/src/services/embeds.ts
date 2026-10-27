// «Innbygging» (M1.6, K-225): what an embed block shows, decided by the server when content is saved, never by what the editor
// sent. For each core/embed block the provider is found from the address (the fixed list in shared/oembed.ts, Mastodon instances
// from «Personvern»), its oEmbed endpoint is asked through safeFetch (no private addresses, also after a redirect), and only the
// checked fields are kept: the player's address on the provider's own hosts, the title, the size, and a thumbnail stored in the
// media library (the site never loads anything from the provider before the reader clicks). An address of no known provider, or
// an answer that does not pass, leaves a plain link. Answers are kept in `oembed_cache` for a day.
//
// The asking happens before the save's transaction (fillEmbeds on the sent tree), so no row is locked while a provider answers.
import type { Database } from '@toascribe/db'
import { schema } from '@toascribe/db'
import { SafeFetchError } from '@toascribe/http'
import type { SafeFetchOptions, SafeResponse } from '@toascribe/http'
import {
  CoreSettings,
  OEmbedAnswer,
  embedEndpoint,
  embedFrameOf,
  embedProviderOf,
  embedSize,
  isSafeEmbedLink,
} from '@toascribe/shared'
import type { EmbedPreviewResponse, EmbedProvider } from '@toascribe/shared'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import type { SessionAuth } from '../lib/auth-context.ts'
import { ForbiddenError } from '../lib/errors.ts'
import { readSettings } from '../repositories/settings.ts'
import type { MediaService } from './media.ts'
import type { RequestContext } from './support.ts'

const { oembedCache } = schema

/** How the providers are asked: safeFetch (the app passes it); a test passes stored answers. */
export type EmbedFetch = (url: string, options?: SafeFetchOptions) => Promise<SafeResponse>
const EMBED_SETTINGS = CoreSettings.pick({ oembed_mastodon_instances: true })
const VISITOR = { id: '', capabilities: new Set<string>() } as const

/** How long an answer is kept before the provider is asked again. */
const KEEP_MS = 24 * 60 * 60 * 1000
/** The most embeds read in one save (the rest stay links): a post is not a way to make the server fetch without end. */
export const MAX_EMBEDS_PER_SAVE = 20
/** The longest address kept in the cache (its key column has a limit; a longer one is asked every time). */
const MAX_CACHED_URL = 2000
const ANSWER_MAX_BYTES = 256 * 1024
const THUMBNAIL_MAX_BYTES = 5 * 1024 * 1024

/** What is kept of an answer, per address. */
const Cached = z.object({
  provider: z.string(),
  title: z.string(),
  authorName: z.string(),
  frameSrc: z.string(),
  width: z.int(),
  height: z.int(),
  thumbnailUrl: z.string().nullable(),
  /** The thumbnail in the media library, once one was stored for this address. */
  thumbnailId: z.string().nullable(),
})
type Cached = z.infer<typeof Cached>

/** The extension of a thumbnail from its first bytes (the provider's address need not have one): JPEG, PNG, WebP or GIF only. */
function imageExtension(bytes: Uint8Array): string | undefined {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value)
  if (starts(0xff, 0xd8, 0xff)) return 'jpg'
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'png'
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'gif'
  if (
    starts(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp'
  }
  return undefined
}

export interface EmbedService {
  /** What the editor shows for an address (edit_posts, edit_pages or edit_theme_options). */
  preview(auth: SessionAuth, url: string): Promise<EmbedPreviewResponse>
  /** The sent tree with every embed block's fields set by the server. Unknown input is passed through for validation to judge. */
  fill(auth: SessionAuth, blocks: unknown, ctx: RequestContext): Promise<unknown>
}

export function createEmbedService(options: {
  readonly db: Database
  readonly clock: () => Date
  readonly fetch: EmbedFetch
  readonly media: Pick<MediaService, 'contentRefs' | 'upload'>
  readonly onInvalidSetting?: (key: string) => void
}): EmbedService {
  const { db, clock, media } = options

  async function fromCache(url: string): Promise<Cached | undefined> {
    if (url.length > MAX_CACHED_URL) return undefined
    const [row] = await db
      .select({ data: oembedCache.data, expiresAt: oembedCache.expiresAt })
      .from(oembedCache)
      .where(eq(oembedCache.url, url))
      .limit(1)
    if (row === undefined || row.expiresAt.getTime() <= clock().getTime()) return undefined
    const parsed = Cached.safeParse(row.data)
    return parsed.success ? parsed.data : undefined
  }

  async function keep(url: string, data: Cached): Promise<void> {
    if (url.length > MAX_CACHED_URL) return
    const now = clock()
    const expiresAt = new Date(now.getTime() + KEEP_MS)
    await db
      .insert(oembedCache)
      .values({ url, data, expiresAt })
      .onConflictDoUpdate({ target: oembedCache.url, set: { data, expiresAt, modifiedAt: now } })
  }

  /** Asks the provider; undefined when it does not answer with something that passes. */
  async function ask(provider: EmbedProvider, url: string): Promise<Cached | undefined> {
    let answer: OEmbedAnswer
    try {
      const response = await options.fetch(embedEndpoint(provider, url), {
        headers: { accept: 'application/json' },
        maxBytes: ANSWER_MAX_BYTES,
        timeoutMs: 8000,
        maxRedirects: 3,
      })
      if (response.status !== 200) return undefined
      answer = OEmbedAnswer.parse(JSON.parse(response.text()))
    } catch (error) {
      if (error instanceof SafeFetchError || error instanceof SyntaxError || error instanceof z.ZodError)
        return undefined
      throw error
    }
    const frameSrc = embedFrameOf(provider, answer, url)
    if (frameSrc === undefined) return undefined
    const thumbnail = answer.thumbnail_url
    return {
      provider,
      title: (answer.title ?? '').slice(0, 500),
      authorName: (answer.author_name ?? '').slice(0, 500),
      frameSrc,
      width: embedSize(answer.width) ?? 0,
      height: embedSize(answer.height) ?? 0,
      thumbnailUrl: thumbnail?.startsWith('https://') === true ? thumbnail : null,
      thumbnailId: null,
    }
  }

  /** The answer for an address, from the cache or the provider; undefined for an address without a provider or a usable answer. */
  async function lookup(url: string, mastodonHosts: readonly string[]): Promise<Cached | undefined> {
    const provider = embedProviderOf(url, mastodonHosts)
    if (provider === undefined) return undefined
    const cached = await fromCache(url)
    if (cached !== undefined) return cached
    const fresh = await ask(provider, url)
    if (fresh !== undefined) await keep(url, fresh)
    return fresh
  }

  /**
   * The thumbnail in the media library: the one stored for this address while it is there and public, or a new one fetched
   * through safeFetch by an account that may upload. None otherwise (the site shows the service's name and the title).
   */
  async function thumbnailOf(auth: SessionAuth, url: string, data: Cached, ctx: RequestContext): Promise<string> {
    if (data.thumbnailId !== null && (await media.contentRefs(VISITOR, [data.thumbnailId])).length === 1) {
      return data.thumbnailId
    }
    if (data.thumbnailUrl === null || !auth.capabilities.has('upload_files')) return ''
    try {
      const response = await options.fetch(data.thumbnailUrl, { maxBytes: THUMBNAIL_MAX_BYTES, timeoutMs: 15_000 })
      if (response.status !== 200) return ''
      const extension = imageExtension(response.body)
      if (extension === undefined) return ''
      const name = `${data.provider}-${new URL(url).pathname.split('/').filter(Boolean).pop() ?? 'innbygging'}`
      const item = await media.upload(
        auth,
        {
          bytes: response.body,
          fileName: `${name.replace(/[^\w-]+/g, '-').slice(0, 80)}.${extension}`,
          title: data.title,
        },
        ctx,
      )
      if (!item.mime.startsWith('image/')) return ''
      await keep(url, { ...data, thumbnailId: item.id })
      return item.id
    } catch (error) {
      // A thumbnail is a nicety: a failed fetch or a file the library refuses leaves the embed without one.
      if (error instanceof SafeFetchError || (error instanceof Error && 'status' in error)) return ''
      throw error
    }
  }

  function mayEmbed(auth: SessionAuth): boolean {
    return ['edit_posts', 'edit_pages', 'edit_theme_options'].some((capability) => auth.capabilities.has(capability))
  }

  return {
    async preview(auth, url) {
      if (!mayEmbed(auth)) throw new ForbiddenError()
      const { oembed_mastodon_instances: hosts } = await readSettings(db, EMBED_SETTINGS, options.onInvalidSetting)
      const found = isSafeEmbedLink(url) ? await lookup(url, hosts) : undefined
      return found === undefined
        ? { provider: null, title: '', frameSrc: '', thumbnailUrl: null }
        : {
            provider: found.provider as EmbedProvider,
            title: found.title,
            frameSrc: found.frameSrc,
            thumbnailUrl: found.thumbnailUrl,
          }
    },

    async fill(auth, blocks, ctx) {
      if (!Array.isArray(blocks)) return blocks
      const { oembed_mastodon_instances: hosts } = await readSettings(db, EMBED_SETTINGS, options.onInvalidSetting)
      let read = 0
      const walk = async (list: unknown[]): Promise<unknown[]> => {
        const out: unknown[] = []
        for (const node of list) {
          if (typeof node !== 'object' || node === null) {
            out.push(node)
            continue
          }
          const block = node as Record<string, unknown>
          const children = Array.isArray(block['children'])
            ? await walk(block['children'] as unknown[])
            : block['children']
          if (block['type'] !== 'core/embed' || typeof block['attrs'] !== 'object' || block['attrs'] === null) {
            out.push({ ...block, children })
            continue
          }
          const attrs = block['attrs'] as Record<string, unknown>
          const url = typeof attrs['url'] === 'string' ? attrs['url'].trim() : ''
          const found = isSafeEmbedLink(url) && read < MAX_EMBEDS_PER_SAVE ? await lookup(url, hosts) : undefined
          if (embedProviderOf(url, hosts) !== undefined) read += 1
          const set =
            found === undefined
              ? { provider: '', title: '', authorName: '', frameSrc: '', width: 0, height: 0, thumbnailId: '' }
              : {
                  provider: found.provider,
                  title: found.title,
                  authorName: found.authorName,
                  frameSrc: found.frameSrc,
                  width: found.width,
                  height: found.height,
                  thumbnailId: await thumbnailOf(auth, url, found, ctx),
                }
          out.push({ ...block, children, attrs: { ...attrs, url, ...set } })
        }
        return out
      }
      return walk(blocks)
    },
  }
}
