// The site's `frame-src` for «Innbygging» (M1.6, K-225): the hosts players come from, as the api lists them (the fixed providers'
// and the Mastodon instances in «Personvern»), added to the policy nuxt-security wrote. Never `*`, never a scheme or a path: a host
// that is not a plain name is left out.
const HOST = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/

/** The policy with `https://<host>` for each host in `frame-src` (made when there is none). */
export function withFrameHosts(policy: string, hosts: readonly string[]): string {
  const sources = [...new Set(hosts.filter((host) => HOST.test(host)).map((host) => `https://${host}`))]
  if (sources.length === 0) return policy
  const directives = policy
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '')
  const at = directives.findIndex((part) => part.split(/\s+/)[0]?.toLowerCase() === 'frame-src')
  if (at === -1) return [...directives, `frame-src 'self' ${sources.join(' ')}`].join('; ') + ';'
  const existing = directives[at]?.split(/\s+/) ?? ['frame-src']
  directives[at] = [...existing, ...sources.filter((source) => !existing.includes(source))].join(' ')
  return directives.join('; ') + ';'
}
