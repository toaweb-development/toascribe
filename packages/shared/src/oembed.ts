// oEmbed (M1.6, K-225): a fixed list of providers (Tor's decision; no discovery), each with the addresses of its content, its oEmbed
// endpoint and the hosts its player is served from. The api asks the endpoint when content is saved (through safeFetch) and keeps
// only what is listed here: never the provider's HTML. The player's address is taken out of that HTML (or built from it, for the
// providers that answer with a script: Bluesky and Mastodon), checked against the provider's own hosts, and stored as a plain
// attribute of the «Innbygging» block; the site draws the iframe itself, and checks the address again before it does.
//
// Verified against each provider's live endpoint and WordPress' class-wp-oembed.php on 2026-10-27. TikTok answers with its iframe
// player now (`/player/v1/<id>`); YouTube is shown from youtube-nocookie.com (privacy-enhanced mode), which oEmbed never returns, so
// the address is rewritten here.
import { z } from 'zod'

export const EMBED_PROVIDERS = ['youtube', 'vimeo', 'spotify', 'soundcloud', 'tiktok', 'bluesky', 'mastodon'] as const
export const EmbedProvider = z.enum(EMBED_PROVIDERS)
export type EmbedProvider = z.infer<typeof EmbedProvider>

/** The name a reader sees («Innholdet lastes fra YouTube»). */
export const EMBED_PROVIDER_NAMES: Readonly<Record<EmbedProvider, string>> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  spotify: 'Spotify',
  soundcloud: 'SoundCloud',
  tiktok: 'TikTok',
  bluesky: 'Bluesky',
  mastodon: 'Mastodon',
}

/**
 * The hosts each provider's player is served from: what `frame-src` on the site allows (never `*`). Mastodon's are the instances
 * the site's settings list, added at run time.
 */
export const EMBED_FRAME_HOSTS: Readonly<Record<Exclude<EmbedProvider, 'mastodon'>, readonly string[]>> = {
  youtube: ['www.youtube-nocookie.com'],
  vimeo: ['player.vimeo.com'],
  spotify: ['open.spotify.com'],
  soundcloud: ['w.soundcloud.com'],
  tiktok: ['www.tiktok.com'],
  bluesky: ['embed.bsky.app'],
}

/** A host name as an instance list may hold it: lower case, dots, no port or path. */
export const InstanceHost = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, {
    message: 'a host name, like mastodon.social',
  })

function parse(value: string): URL | undefined {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.username === '' && url.password === '' && url.port === '' ? url : undefined
  } catch {
    return undefined
  }
}

/** The provider of a content address, or undefined (the address is then a plain link). Only https addresses are embedded. */
export function embedProviderOf(address: string, mastodonHosts: readonly string[] = []): EmbedProvider | undefined {
  const url = parse(address)
  if (url === undefined) return undefined
  const host = url.hostname.toLowerCase()
  const path = url.pathname
  if (
    ((host === 'www.youtube.com' || host === 'youtube.com' || host === 'm.youtube.com') &&
      (/^\/watch$/.test(path) || /^\/playlist$/.test(path) || /^\/(shorts|live)\/[\w-]{6,20}\/?$/.test(path))) ||
    (host === 'youtu.be' && /^\/[\w-]{6,20}$/.test(path))
  ) {
    return 'youtube'
  }
  if ((host === 'vimeo.com' || host === 'www.vimeo.com') && /^\/(\d+|[\w/-]+\/\d+)\/?$/.test(path)) return 'vimeo'
  if (
    (host === 'open.spotify.com' || host === 'play.spotify.com') &&
    /^\/(intl-[a-z-]+\/)?[a-z]+\/[\w]+\/?$/i.test(path)
  ) {
    return 'spotify'
  }
  if (
    (host === 'soundcloud.com' || host === 'www.soundcloud.com' || host === 'on.soundcloud.com') &&
    /^\/[\w./-]+$/.test(path)
  ) {
    return 'soundcloud'
  }
  if ((host === 'www.tiktok.com' || host === 'tiktok.com') && /^\/@[\w.-]+\/video\/\d+\/?$/.test(path)) return 'tiktok'
  if (host === 'bsky.app' && /^\/profile\/[\w.:-]+\/post\/[\w]+\/?$/.test(path)) return 'bluesky'
  if (mastodonHosts.includes(host) && /^\/@[\w.-]+(@[\w.-]+)?\/\d+\/?$/.test(path)) return 'mastodon'
  return undefined
}

/** The oEmbed endpoint to ask for a content address (JSON). */
export function embedEndpoint(provider: EmbedProvider, address: string): string {
  const url = encodeURIComponent(address)
  switch (provider) {
    case 'youtube':
      return `https://www.youtube.com/oembed?format=json&url=${url}`
    case 'vimeo':
      return `https://vimeo.com/api/oembed.json?url=${url}`
    case 'spotify':
      return `https://open.spotify.com/oembed?url=${url}`
    case 'soundcloud':
      return `https://soundcloud.com/oembed?format=json&url=${url}`
    case 'tiktok':
      return `https://www.tiktok.com/oembed?url=${url}`
    case 'bluesky':
      return `https://embed.bsky.app/oembed?format=json&url=${url}`
    case 'mastodon':
      return `https://${new URL(address).hostname}/api/oembed?format=json&url=${url}`
  }
}

/** What an oEmbed endpoint answers, as far as toascribe reads it (anything else in it is ignored). */
export const OEmbedAnswer = z.object({
  type: z.enum(['video', 'rich', 'photo', 'link']),
  title: z.string().max(2000).optional(),
  author_name: z.string().max(500).optional(),
  html: z.string().max(100_000).optional(),
  width: z.union([z.number(), z.string()]).nullable().optional(),
  height: z.union([z.number(), z.string()]).nullable().optional(),
  thumbnail_url: z.string().max(2000).optional(),
})
export type OEmbedAnswer = z.infer<typeof OEmbedAnswer>

/** The value of one attribute of the first element of a name in HTML, decoded; undefined when there is none. */
function attributeOf(html: string, element: string, attribute: string): string | undefined {
  const tag = new RegExp(`<${element}\\b[^>]*>`, 'i').exec(html)?.[0]
  if (tag === undefined) return undefined
  const found = new RegExp(`\\s${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)
  const raw = found?.[1] ?? found?.[2]
  return raw
    ?.replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
}

/**
 * Whether a player address may be drawn for a provider: https, on one of its hosts (for Mastodon, the content's own instance), and
 * in the shape of its player. The site checks this again before it draws an iframe.
 */
export function isEmbedFrame(provider: EmbedProvider, src: string, contentAddress: string): boolean {
  const url = parse(src)
  if (url?.hash !== '') return false
  const host = url.hostname.toLowerCase()
  const path = url.pathname
  switch (provider) {
    case 'youtube':
      return host === 'www.youtube-nocookie.com' && /^\/embed\/(videoseries|[\w-]{6,20})$/.test(path)
    case 'vimeo':
      return host === 'player.vimeo.com' && /^\/video\/\d+$/.test(path)
    case 'spotify':
      return host === 'open.spotify.com' && /^\/embed\/[a-z-]+\/[\w]+$/i.test(path)
    case 'soundcloud':
      return host === 'w.soundcloud.com' && path === '/player/'
    case 'tiktok':
      return host === 'www.tiktok.com' && /^\/player\/v1\/\d+$/.test(path)
    case 'bluesky':
      return host === 'embed.bsky.app' && /^\/embed\/did:[a-z]+:[\w.:%-]+\/app\.bsky\.feed\.post\/[\w]+$/.test(path)
    case 'mastodon': {
      const content = parse(contentAddress)
      return host === content?.hostname.toLowerCase() && /^\/@[\w.-]+\/\d+\/embed$/.test(path)
    }
  }
}

/** The player's address from an oEmbed answer, after the checks above; undefined when there is none that passes. */
export function embedFrameOf(
  provider: EmbedProvider,
  answer: OEmbedAnswer,
  contentAddress: string,
): string | undefined {
  const html = answer.html ?? ''
  let src: string | undefined
  if (provider === 'bluesky') {
    // `<blockquote data-bluesky-uri="at://did:plc:…/app.bsky.feed.post/<rkey>">` and a script that would build this iframe.
    const uri = attributeOf(html, 'blockquote', 'data-bluesky-uri')
    const at = uri === undefined ? null : /^at:\/\/(did:[a-z]+:[\w.:%-]+)\/app\.bsky\.feed\.post\/([\w]+)$/.exec(uri)
    src = at === null ? undefined : `https://embed.bsky.app/embed/${at[1] ?? ''}/app.bsky.feed.post/${at[2] ?? ''}`
  } else if (provider === 'mastodon') {
    // `<blockquote data-embed-url="https://<instance>/@user/<id>/embed">` and the instance's embed.js.
    src = attributeOf(html, 'blockquote', 'data-embed-url')
  } else {
    src = attributeOf(html, 'iframe', 'src')
  }
  if (src === undefined) return undefined
  const url = parse(src)
  if (url === undefined) return undefined
  if (provider === 'youtube') {
    // YouTube's own player only, moved to privacy-enhanced mode, with only the parameter a playlist needs.
    if (!['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com'].includes(url.hostname.toLowerCase()))
      return undefined
    const list = url.searchParams.get('list')
    url.hostname = 'www.youtube-nocookie.com'
    url.search = list !== null && /^[\w-]{1,64}$/.test(list) ? `?list=${list}` : ''
  }
  if (provider === 'tiktok' || provider === 'vimeo' || provider === 'spotify') url.search = ''
  const address = url.toString()
  return isEmbedFrame(provider, address, contentAddress) ? address : undefined
}

/** A size from an oEmbed answer as a whole number of pixels, or null (Bluesky and Mastodon have no height). */
export function embedSize(value: number | string | null | undefined): number | null {
  const number = typeof value === 'string' ? Number(value) : value
  return typeof number === 'number' && Number.isInteger(number) && number > 0 && number <= 4000 ? number : null
}

/** POST /oembed/preview: what the editor shows for an address before the post is saved. */
export const EmbedPreviewRequest = z.strictObject({ url: z.string().min(1).max(2000) })
export const EmbedPreviewResponse = z.object({
  provider: EmbedProvider.nullable(),
  title: z.string(),
  frameSrc: z.string(),
  thumbnailUrl: z.string().nullable(),
})
export type EmbedPreviewResponse = z.infer<typeof EmbedPreviewResponse>

/** An address an «Innbygging» block may link to: http or https on another host, with no user name or password in it. */
export function isSafeEmbedLink(address: string): boolean {
  try {
    const url = new URL(address)
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.username === '' && url.password === ''
  } catch {
    return false
  }
}
