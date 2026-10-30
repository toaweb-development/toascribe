// Gravatar's host in the admin's img-src only while «Personvern → Vis Gravatar» is on (M2.1; off by default, M1.8 K-236): added once
// nuxt-security has written the page's policy (beforeResponse runs after the render hooks). The setting is read from the api's
// public settings and kept for 30 seconds, so a page does not ask each time; a failed read leaves the policy as written (no host).
import { PublicSettings } from '@toascribe/shared'

import { withImageHost } from '../lib/csp'

const GRAVATAR_HOST = 'secure.gravatar.com'
const KEEP_MS = 30_000
let known: { readonly at: number; readonly on: boolean } | undefined

async function gravatarOn(): Promise<boolean> {
  const now = Date.now()
  if (known !== undefined && now - known.at < KEEP_MS) return known.on
  try {
    const base = String(useRuntimeConfig().apiUrlInternal).replace(/\/+$/, '')
    const settings = PublicSettings.parse(await $fetch(`${base}/api/v1/public/settings`))
    known = { at: now, on: settings.gravatar }
  } catch {
    known = { at: now, on: false }
  }
  return known.on
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', async (event) => {
    const policy = getResponseHeader(event, 'content-security-policy')
    const type = getResponseHeader(event, 'content-type')
    if (typeof policy !== 'string' || typeof type !== 'string' || !type.startsWith('text/html')) return
    if (await gravatarOn()) setResponseHeader(event, 'content-security-policy', withImageHost(policy, GRAVATAR_HOST))
  })
})
