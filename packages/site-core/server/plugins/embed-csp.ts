// `frame-src` for «Innbygging» (M1.6, K-225): the hosts the api lists for players (the fixed providers' and the Mastodon instances
// in «Personvern»), added once nuxt-security has written the page's policy (beforeResponse runs after every render:response hook),
// from the settings through the cache by tag. A page without the settings keeps the policy as written: no player loads.
import { PublicSettings } from '@toascribe/shared'

import { withFrameHosts } from '../../lib/embed-csp'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', async (event) => {
    const policy = getResponseHeader(event, 'content-security-policy')
    const type = getResponseHeader(event, 'content-type')
    if (typeof policy !== 'string' || typeof type !== 'string' || !type.startsWith('text/html')) return
    try {
      const settings = PublicSettings.parse(await cachedFromPublicApi(event, '/settings'))
      setResponseHeader(event, 'content-security-policy', withFrameHosts(policy, settings.embed.frameHosts))
    } catch {
      // The policy stays as nuxt-security wrote it.
    }
  })
})
