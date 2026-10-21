// Checks on the files a user downloads and runs (docker/compose.yaml, docker/.env.example) that a build or a
// type check cannot catch. The stack itself is proven by CI, which builds the images and runs `docker compose up`.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = new URL('../', import.meta.url)

function read(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, ROOT)), 'utf8')
}

const compose = read('docker/compose.yaml')
const envExample = read('docker/.env.example')
const caddyfile = read('docker/proxy/Caddyfile')
const readme = read('README.md')
const composeBuild = read('docker/compose.build.yaml')
const ciWorkflow = read('.github/workflows/ci.yml')
const initScript = read('docker/postgres/10-init.sh')
const postgresDockerfile = read('docker/postgres/Dockerfile')

/** The text of one service in compose.yaml, from `  name:` to the next service (two-space indent) or the networks. */
function service(name: string): string {
  const start = compose.indexOf(`\n  ${name}:\n`)
  expect(start, `service ${name}`).toBeGreaterThan(-1)
  const rest = compose.slice(start + 1)
  const next = rest.slice(name.length + 4).search(/^(?: {2}[a-z]|[a-z])/m)
  return next === -1 ? rest : rest.slice(0, name.length + 4 + next)
}

/** Names set in .env.example, commented out or not: `NAME=` at the start of a line. */
function documentedVariables(text: string): Set<string> {
  const names = new Set<string>()
  for (const match of text.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)) {
    if (match[1] !== undefined) names.add(match[1])
  }
  return names
}

/** Variables compose reads from .env: every `${NAME` in the file. */
function interpolatedVariables(text: string): Set<string> {
  const names = new Set<string>()
  for (const match of text.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)) {
    if (match[1] !== undefined) names.add(match[1])
  }
  return names
}

describe('docker/compose.yaml', () => {
  it('names every image after the root version', () => {
    const rootManifest: unknown = JSON.parse(read('package.json'))
    const version =
      typeof rootManifest === 'object' && rootManifest !== null && 'version' in rootManifest
        ? rootManifest.version
        : undefined
    expect(typeof version).toBe('string')
    // One default per image, all the same, and the same as package.json (VERSIONING_STANDARD §3: update every mirror).
    const defaults = [
      ...compose.matchAll(/\$\{TOASCRIBE_VERSION:-([^}]+)\}/g),
      ...composeBuild.matchAll(/\$\{TOASCRIBE_VERSION:-([^}]+)\}/g),
    ].map((match) => match[1])
    expect(defaults.length).toBeGreaterThanOrEqual(10)
    for (const found of defaults) expect(found).toBe(version)
    expect(envExample).toContain(`TOASCRIBE_VERSION=${String(version)}`)
  })

  it('reads only variables that .env.example documents', () => {
    const documented = documentedVariables(envExample)
    const missing = [...interpolatedVariables(compose)].filter((name) => !documented.has(name))
    expect(missing).toEqual([])
  })

  it('stops with a message when a password is empty', () => {
    for (const name of ['POSTGRES_PASSWORD', 'POSTGRES_OWNER_PASSWORD', 'POSTGRES_APP_PASSWORD']) {
      expect(compose).toContain(`\${${name}:?`)
    }
  })

  it('gives MIGRATION_DATABASE_URL to one service only', () => {
    expect(compose.match(/MIGRATION_DATABASE_URL:/g)).toHaveLength(1)
    const migrate = compose.slice(compose.indexOf('  migrate:'), compose.indexOf('  postgres:'))
    expect(migrate).toContain('MIGRATION_DATABASE_URL:')
  })

  it('publishes two ports at most: the proxy, and the development-only mailpit page on loopback', () => {
    expect(compose.match(/^\s+ports:/gm)).toHaveLength(2)
    expect(service('proxy')).toContain('ports:')
    const mailpit = service('mailpit')
    expect(mailpit).toContain('ports:')
    // Bound to 127.0.0.1 in the file itself: no variable can widen it, and the page has no login.
    expect(mailpit).toContain("- '127.0.0.1:${TOASCRIBE_MAILPIT_PORT:-8025}:8025'")
    expect(mailpit).not.toMatch(/'[^']*:1025'/) // SMTP stays on the internal network
  })

  it('binds the published port to loopback unless TOASCRIBE_HTTP_BIND says otherwise', () => {
    expect(compose).toContain("'${TOASCRIBE_HTTP_BIND:-127.0.0.1}:${TOASCRIBE_HTTP_PORT:-8080}:8080'")
  })

  it('trusts no proxy unless TOASCRIBE_TRUSTED_PROXY names one', () => {
    expect(compose).toContain('TOASCRIBE_TRUSTED_PROXY: ${TOASCRIBE_TRUSTED_PROXY:-}')
    expect(compose).not.toContain('private_ranges')
    expect(envExample).not.toMatch(/^TOASCRIBE_TRUSTED_PROXY=\S/m)
  })

  it('pins every image that is not built here by tag and digest', () => {
    const external = [...compose.matchAll(/^\s+image: (?!ghcr\.io\/toaweb\/)(\S+)/gm)].map((match) => match[1])
    expect(external.length).toBeGreaterThanOrEqual(2) // valkey, mailpit
    for (const image of external) expect(image).toMatch(/:[^@/]+@sha256:[0-9a-f]{64}$/)
  })

  it('stops with a message when a key is empty, and gives the signing key to the api only', () => {
    expect(compose).toContain('${TOASCRIBE_ENCRYPTION_KEY:?')
    expect(compose).toContain('${TOASCRIBE_SIGNING_KEY:?')
    expect(service('api')).toContain('TOASCRIBE_SIGNING_KEY:')
    expect(service('worker')).not.toContain('TOASCRIBE_SIGNING_KEY')
    for (const name of ['migrate', 'site', 'admin', 'proxy', 'postgres']) {
      expect(service(name)).not.toMatch(/TOASCRIBE_(ENCRYPTION|SIGNING)_/)
    }
  })

  it('gives the encryption keys and the public origin to the api and the worker, the same way', () => {
    for (const name of ['api', 'worker']) {
      const text = service(name)
      expect(text).toContain('PUBLIC_ORIGIN: ${PUBLIC_ORIGIN:-http://localhost:${TOASCRIBE_HTTP_PORT:-8080}}')
      expect(text).toContain('${TOASCRIBE_ENCRYPTION_KEY:?')
      // An empty string would be read as 0 by the apps (z.coerce.number), which they refuse: the default is 1.
      expect(text).toContain('TOASCRIBE_ENCRYPTION_KEY_VERSION: ${TOASCRIBE_ENCRYPTION_KEY_VERSION:-1}')
      expect(text).toContain('TOASCRIBE_ENCRYPTION_OLD_KEYS: ${TOASCRIBE_ENCRYPTION_OLD_KEYS:-}')
    }
  })

  it('passes the e-mail defaults to the worker as optional values, and to nobody else', () => {
    const names = [
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_SECURE',
      'SMTP_USERNAME',
      'SMTP_PASSWORD',
      'MAIL_FROM_ADDRESS',
      'MAIL_FROM_NAME',
    ]
    const worker = service('worker')
    for (const name of names) {
      expect(worker).toContain(`${name}: \${${name}:-}`)
      expect(envExample).toMatch(new RegExp(`^${name}=$`, 'm'))
      expect(compose.match(new RegExp(`^\\s+${name}:`, 'gm'))).toHaveLength(1)
    }
  })

  it('keeps mailpit optional and hardened, and nothing depends on it', () => {
    const mailpit = service('mailpit')
    expect(mailpit).toMatch(/profiles:\n\s+- mailpit/)
    expect(mailpit).toMatch(/user: '[1-9][0-9]*:[1-9][0-9]*'/) // the image runs as root by default
    expect(mailpit).toContain('read_only: true')
    expect(mailpit).toContain('<<: *hardened') // cap_drop ALL and no-new-privileges
    expect(mailpit).toContain("['CMD', '/mailpit', 'readyz']")
    expect(mailpit).toMatch(/networks:\n\s+- internal\n/)
    expect(mailpit).not.toContain('- db')
    expect(compose.replace(mailpit, '')).not.toMatch(/^\s+mailpit:\n\s+condition:/m)
  })

  it('uses the same mailpit image in compose.yaml and in CI', () => {
    const pattern = /axllent\/mailpit:v[0-9.]+@sha256:[0-9a-f]{64}/
    const inCompose = pattern.exec(compose)?.[0]
    expect(inCompose).toBeDefined()
    expect(ciWorkflow).toContain(String(inCompose))
  })

  it('needs no file from the repo at run time', () => {
    // A bind mount of a repo file would break for a user who downloads only compose.yaml and .env.
    expect(compose).not.toMatch(/^\s+- \.{1,2}\//m)
    expect(compose).not.toMatch(/^\s+env_file:/m)
  })
})

describe('docker/compose.build.yaml', () => {
  /** The lines that say what is built: image names, Dockerfiles and build arguments, without the context. */
  function buildLines(text: string): string[] {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^(image: ghcr\.io\/|dockerfile: |APP: |HEALTH_PATH: )/.test(line))
      .sort()
  }

  it('builds the same images as compose.yaml', () => {
    const fromCompose = buildLines(compose)
    expect(fromCompose.length).toBeGreaterThanOrEqual(11)
    expect(buildLines(composeBuild)).toEqual(fromCompose)
  })

  it('needs no password to be read', () => {
    expect(composeBuild).not.toContain(':?')
  })
})

describe('docker/.env.example', () => {
  it('has no value for any password or secret', () => {
    const lines = envExample.split('\n').filter((line) => /^[A-Z_]*(PASSWORD|SECRET|KEY|TOKEN)[A-Z_]*=/.test(line))
    expect(lines.length).toBeGreaterThanOrEqual(3)
    for (const line of lines) expect(line).toMatch(/=$/)
  })

  it('contains no placeholder password anywhere in docker/', () => {
    for (const text of [compose, envExample, caddyfile]) {
      expect(text.toLowerCase()).not.toContain('changeme')
      expect(text.toLowerCase()).not.toContain('change_me')
    }
  })
})

describe('docker/proxy/Caddyfile', () => {
  it('writes each handle block on several lines', () => {
    // `handle /x { reverse_proxy … }` on one line does not parse (caddy validate: "Unexpected next token after '{'").
    expect(caddyfile).not.toMatch(/^\s*handle[^\n]*\{[^\n]*\}/m)
  })

  it('sends /setup to the admin app with a 308, after the path check', () => {
    // A bare `redir` is ordered before every `handle`, so it would run before the 400 for an unnormalised path.
    expect(caddyfile).not.toMatch(/^\s*redir @setup/m)
    const redirect = caddyfile.indexOf('redir * /admin{uri} 308')
    expect(redirect).toBeGreaterThan(-1)
    expect(caddyfile.indexOf('handle @unnormalized')).toBeLessThan(caddyfile.indexOf('handle @setup'))
    expect(caddyfile.indexOf('handle @setup')).toBeLessThan(redirect)
    expect(redirect).toBeLessThan(caddyfile.indexOf('handle /api/*'))
  })

  it('sends the sign-in screens and the WordPress addresses to the admin app with a 308, after the path check', () => {
    const code = caddyfile
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n')
    // Only inside `handle` blocks (a bare `redir` or `rewrite` would run before the 400 for an unnormalised path), and
    // with the `*` matcher: a first argument that starts with "/" would be read as a path matcher.
    expect(code).not.toMatch(/^\s*redir (?!\* )/m)
    expect(code.match(/^\s*rewrite /gm)).toHaveLength(1) // the one inside the route below
    const blocks: [string, string][] = [
      ['@auth', 'redir * /admin{uri} 308'],
      ['@wplogin', 'rewrite * /admin/login'],
      ['@wpadmin', 'redir * /admin 308'],
    ]
    for (const [matcher, body] of blocks) {
      const at = code.indexOf(`handle ${matcher} {`)
      expect(at, matcher).toBeGreaterThan(-1)
      expect(at).toBeGreaterThan(code.indexOf('handle @unnormalized'))
      expect(at).toBeLessThan(code.indexOf('handle /api/*'))
      expect(code.indexOf(body, at), body).toBeGreaterThan(at)
      expect(code.indexOf(body, at)).toBeLessThan(code.indexOf('handle /api/*'))
    }
    expect(code).toMatch(/@auth path \/login \/login\/ \/register \/register\/ \/logout \/logout\//)
    expect(code).toContain('@wplogin path /wp-login.php')
    expect(code).toContain('@wpadmin path /wp-admin /wp-admin/*')
    // The rewrite and the redirect keep their order only inside a `route`.
    expect(code).toMatch(/route \{\n\s+rewrite \* \/admin\/login\n\s+redir \* \{uri\} 308\n\s+\}/)
  })

  it('believes forwarded headers from one configured address only, never private_ranges', () => {
    const code = caddyfile
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n')
    expect(code).not.toContain('private_ranges')
    // No default after the name: an empty value must stay empty, which means "trust nobody".
    expect(code).toMatch(/^\s*trusted_proxies static \{\$TOASCRIBE_TRUSTED_PROXY\}\s*$/m)
  })

  it('reads X-Forwarded-For from the right and gives the apps one client-IP header', () => {
    const code = caddyfile
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n')
    // Without it Caddy takes the leftmost entry, which a visitor writes when the front proxy appends to the header.
    expect(code).toMatch(/^\s*trusted_proxies_strict\s*$/m)
    expect(code).toMatch(/^\s*client_ip_headers X-Forwarded-For\s*$/m)
    // Every reverse_proxy replaces X-Real-IP with Caddy's own client_ip (the apps read that header only).
    const proxies = code.match(/reverse_proxy /g) ?? []
    const withHeader = code.match(/reverse_proxy \S+ \{\n\s*header_up X-Real-IP \{client_ip\}\n\s*\}/g) ?? []
    expect(proxies).toHaveLength(3)
    expect(withHeader).toHaveLength(proxies.length)
  })

  it('is documented to trust one address, never a network', () => {
    for (const text of [readme, envExample]) {
      expect(text).not.toMatch(/TOASCRIBE_TRUSTED_PROXY=\S*\//)
    }
    expect(readme).toContain('proxy_set_header X-Forwarded-For $remote_addr;')
    expect(readme).not.toContain('$proxy_add_x_forwarded_for;')
    expect(readme).toContain('ipv4_address')
  })

  it('keeps TLS out of the stack', () => {
    expect(caddyfile).toContain('auto_https off')
    expect(caddyfile).toContain('admin off')
  })
})

describe('docker/postgres', () => {
  it('passes the role passwords to psql with \\getenv, not on its command line', () => {
    expect(initScript).toContain('\\getenv owner_password POSTGRES_OWNER_PASSWORD')
    expect(initScript).toContain('\\getenv app_password POSTGRES_APP_PASSWORD')
    expect(initScript).not.toMatch(/-v\s+(owner|app)_password/)
  })

  it('builds gosu from a commit, not from a movable tag', () => {
    expect(postgresDockerfile).toMatch(/go install [^\n]*github\.com\/tianon\/gosu@[0-9a-f]{40}\b/)
  })
})
