// The admin's policy with one more image host (M2.1): Gravatar's, while «Personvern» has it on. Only a plain host name is added, with
// `https://`, never `*`, a scheme or a path.
const HOST = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/

export function withImageHost(policy: string, host: string): string {
  if (!HOST.test(host)) return policy
  const source = `https://${host}`
  const directives = policy
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '')
  const at = directives.findIndex((part) => part.split(/\s+/)[0]?.toLowerCase() === 'img-src')
  if (at === -1) return policy
  const existing = directives[at]?.split(/\s+/) ?? ['img-src']
  if (existing.includes(source)) return policy
  directives[at] = [...existing, source].join(' ')
  return directives.join('; ') + ';'
}
