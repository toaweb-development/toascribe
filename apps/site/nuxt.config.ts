// The public site (M1.4). It extends the theme chosen in toascribe.toml (`[site] theme`), a folder under themes/ with a theme.json;
// the theme extends @toascribe/site-core (the theme SDK and the catch-all route), which extends @toascribe/nuxt-base. A child theme
// extends its parent's folder itself. Layers listed first win, so a setting here beats the theme and the theme beats the core.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { parse } from 'smol-toml'

const ROOT = new URL('../../', import.meta.url)

/** The theme's folder from toascribe.toml; the build stops with a message when it is missing or names no theme. */
function chosenTheme(): string {
  const file = fileURLToPath(new URL('toascribe.toml', ROOT))
  const config = existsSync(file) ? parse(readFileSync(file, 'utf8')) : {}
  const site = config['site']
  const slug = typeof site === 'object' && site !== null && 'theme' in site ? site.theme : 'default'
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
    throw new Error(
      `toascribe.toml: [site] theme must be the slug of a folder under themes/ (got ${JSON.stringify(slug)})`,
    )
  }
  const folder = fileURLToPath(new URL(`themes/${slug}`, ROOT))
  if (!existsSync(`${folder}/theme.json`)) {
    throw new Error(`toascribe.toml: the theme «${slug}» has no themes/${slug}/theme.json`)
  }
  // The image installs only what the site depends on, so the theme must be one of its dependencies.
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('package.json', import.meta.url)), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const name = (JSON.parse(readFileSync(`${folder}/package.json`, 'utf8')) as { name?: string }).name ?? ''
  if (manifest.dependencies?.[name] === undefined) {
    throw new Error(`toascribe.toml: the theme «${slug}» (${name}) must be a dependency of apps/site (package.json)`)
  }
  return folder
}

export default defineNuxtConfig({
  // Which app writes the log line (nuxt-base server/utils/log.ts).
  runtimeConfig: { appName: 'site' },
  extends: [chosenTheme()],

  // The site's part of the security headers (K-314); the nonce CSP and the rest are in nuxt-base. What is different here:
  // - `img-src` takes any https image: themes and posts show pictures from other hosts (an avatar, an embedded post's
  //   picture) and the host is not known when the theme is written. Images cannot run script, and `data:` is for small inline ones.
  //   Scripts, styles, fonts and connections stay at 'self' (a theme that needs another host says so in its own manifest, later).
  // - `frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN`: only the site's own origin frames it, which is the admin's
  //   «Tilpass» preview (M1.5; Tor's decision of M0.4: 'none' until the live preview needs it, then 'self'). No other site can.
  // - The custom HTML block is written as markup on the site (Tor's decision, M1.4; SECURITY.md): only unfiltered_html writes one.
  security: {
    headers: {
      contentSecurityPolicy: {
        'img-src': ["'self'", 'data:', 'https:'],
        'frame-ancestors': ["'self'"],
      },
      xFrameOptions: 'SAMEORIGIN',
      // «Innbygging» (M1.6, K-225): a provider's player is a cross-origin frame that sends no embedder policy of its own, so a
      // site with COEP (credentialless or require-corp) would block every player. The public site needs no cross-origin isolation
      // (nothing on it uses SharedArrayBuffer), so it sends `unsafe-none`; the admin keeps nuxt-base's.
      crossOriginEmbedderPolicy: 'unsafe-none',
      // Full screen for the players that offer it (the providers' own hosts; the iframe asks with `allow="fullscreen"`). Merged into
      // nuxt-base's list, which stays `()` for camera, microphone, geolocation and screen capture.
      permissionsPolicy: {
        fullscreen: [
          'self',
          '"https://www.youtube-nocookie.com"',
          '"https://player.vimeo.com"',
          '"https://www.tiktok.com"',
        ],
      },
    },
  },
})
