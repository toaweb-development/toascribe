// Checks on the files a user downloads and runs (docker/compose.yaml, docker/.env.example) that a build or a
// type check cannot catch. The stack itself is proven by `pnpm release:check`, which builds the images and runs `docker compose up`.
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
const releaseWorkflow = read('.github/workflows/release.yml')
const auditWorkflow = read('.github/workflows/audit.yml')
const releaseCheck = read('scripts/release-check.sh')
const exportImagesScript = read('scripts/export-images.sh')
const digestsScript = read('scripts/image-digests.sh')
const publishImagesScript = read('scripts/publish-images.sh')
const initScript = read('docker/postgres/10-init.sh')
const postgresEntrypoint = read('docker/postgres/entrypoint.sh')
const postgresDockerfile = read('docker/postgres/Dockerfile')
const mailpitDockerfile = read('docker/mailpit/Dockerfile')

/** The text of one service in compose.yaml, from `  name:` to the next service (two-space indent) or the networks. */
function service(name: string): string {
  const start = compose.indexOf(`\n  ${name}:\n`)
  expect(start, `service ${name}`).toBeGreaterThan(-1)
  const rest = compose.slice(start + 1)
  const next = rest.slice(name.length + 4).search(/^(?: {2}[a-z]|[a-z])/m)
  return next === -1 ? rest : rest.slice(0, name.length + 4 + next)
}

/** The text of a file without its `#` comment lines (a comment may mention the very thing a test forbids). */
function withoutComments(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n')
}

/** The shell scripts of a workflow or action: the lines under each `run: |`, which are indented deeper than the key. */
function runScripts(text: string): string[] {
  const lines = text.split('\n')
  const scripts: string[] = []
  lines.forEach((line, index) => {
    if (!/^\s*(?:- )?run: \|\s*$/.test(line)) return
    const indent = line.length - line.trimStart().length
    const body: string[] = []
    for (const next of lines.slice(index + 1)) {
      if (next.trim() !== '' && next.length - next.trimStart().length <= indent) break
      body.push(next)
    }
    scripts.push(body.join('\n'))
  })
  return scripts
}

/** The text of one job of a workflow, from `  name:` to the next job (two-space indent) or the end. */
function job(workflow: string, name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`)
  expect(start, `job ${name}`).toBeGreaterThan(-1)
  const rest = workflow.slice(start + 1)
  const next = rest.slice(name.length + 4).search(/^ {2}[a-z]/m)
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

  it('has no required variable, so `docker compose run --rm --no-deps api toa core gen-env` works on a fresh folder', () => {
    // `${NAME:?message}` makes compose refuse to read the file when NAME is empty, and with it the command that makes
    // the secrets (README, «Run the stack»). The checks are made where the secret is used instead (the tests below).
    expect(withoutComments(compose)).not.toContain(':?')
    for (const name of [
      'POSTGRES_PASSWORD',
      'POSTGRES_OWNER_PASSWORD',
      'POSTGRES_APP_PASSWORD',
      'TOASCRIBE_ENCRYPTION_KEY',
      'TOASCRIBE_SIGNING_KEY',
    ]) {
      expect(compose, name).toMatch(new RegExp(`${name}: \\$\\{${name}:-\\}`))
    }
  })

  it('makes a role URL empty, not password-less, when the role password is empty', () => {
    // `postgres://role:@host/db` is a valid URL that only fails to log in; an empty value fails the apps' own check
    // and names DATABASE_URL or MIGRATION_DATABASE_URL.
    expect(compose).toContain(
      "x-database-url: &database-url '${POSTGRES_APP_PASSWORD:+postgres://toascribe_app:${POSTGRES_APP_PASSWORD:-}@postgres:5432/${POSTGRES_DB:-toascribe}}'",
    )
    expect(compose).toContain(
      "MIGRATION_DATABASE_URL: '${POSTGRES_OWNER_PASSWORD:+postgres://toascribe_owner:${POSTGRES_OWNER_PASSWORD:-}@postgres:5432/${POSTGRES_DB:-toascribe}}'",
    )
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
    const external = [...compose.matchAll(/^\s+image: (?!ghcr\.io\/toaweb-development\/)(\S+)/gm)].map(
      (match) => match[1],
    )
    expect(external.length).toBeGreaterThanOrEqual(1) // valkey (mailpit is built here, on the official image)
    for (const image of external) expect(image).toMatch(/:[^@/]+@sha256:[0-9a-f]{64}$/)
  })

  it('gives the signing key to the api only, and the encryption key to the api and the worker', () => {
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
      expect(text).toContain('TOASCRIBE_ENCRYPTION_KEY: ${TOASCRIBE_ENCRYPTION_KEY:-}')
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

  it('builds mailpit here, on the official image that release:check starts for the e-mail tests', () => {
    expect(service('mailpit')).toContain('image: ghcr.io/toaweb-development/toascribe-mailpit:')
    expect(service('mailpit')).toContain('dockerfile: docker/mailpit/Dockerfile')
    const pattern = /axllent\/mailpit:v[0-9.]+@sha256:[0-9a-f]{64}/
    const inDockerfile = pattern.exec(mailpitDockerfile)?.[0]
    expect(inDockerfile).toBeDefined()
    expect(releaseCheck).toContain(String(inDockerfile))
  })

  it('needs no file from the repo at run time', () => {
    // A bind mount of a repo file would break for a user who downloads only compose.yaml and .env.
    expect(compose).not.toMatch(/^\s+- \.{1,2}\//m)
    expect(compose).not.toMatch(/^\s+env_file:/m)
  })
})

describe('docker/compose.build.yaml', () => {
  /**
   * The lines that say what is built: image names, Dockerfiles and build arguments, without the context. The registry
   * prefix is a variable in the build file (the release builds into a local registry first), so it is put back to its
   * default before the two files are compared.
   */
  function buildLines(text: string): string[] {
    return text
      .replaceAll('${TOASCRIBE_REGISTRY:-ghcr.io/toaweb-development}', 'ghcr.io/toaweb-development')
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

  it('takes the registry from TOASCRIBE_REGISTRY, ghcr.io/toaweb-development by default', () => {
    const images = [...composeBuild.matchAll(/^\s+image: (\S+)$/gm)].map((match) => match[1])
    expect(images).toHaveLength(6)
    for (const image of images)
      expect(image).toMatch(/^\$\{TOASCRIBE_REGISTRY:-ghcr\.io\/toaweb-development\}\/toascribe-[a-z]+:/)
  })

  it('labels every image with the repository, which links the package in the registry to it', () => {
    expect(composeBuild.match(/^\s+labels: \*labels$/gm)).toHaveLength(6)
    expect(composeBuild).toContain('org.opencontainers.image.source: https://github.com/toaweb-development/toascribe')
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

  it('keeps secrets out of both logs: the tokens, the cookies and every query value that is not known to be safe', () => {
    const code = withoutComments(caddyfile)
    // The default `log` redacts Cookie, Authorization, Proxy-Authorization and Set-Cookie but writes X-Setup-Token and
    // X-Csrf-Token (the spelling Go gives X-CSRF-Token) and the whole address in the clear.
    expect(code).not.toMatch(/^\s*log\s*$/m)
    const format = code.slice(code.indexOf('(log_format) {'), code.indexOf(':8081 {'))
    expect(format).toMatch(/format filter \{\n\s+wrap json\n/)
    for (const field of [
      'request>headers>X-Setup-Token',
      'request>headers>X-Csrf-Token',
      'request>headers>Cookie',
      'request>headers>Authorization',
      'request>headers>Proxy-Authorization',
      'resp_headers>Set-Cookie',
      'resp_headers>X-Csrf-Token',
    ]) {
      expect(format, field).toMatch(new RegExp(`^\\s*${field} delete$`, 'm'))
    }
    // The three places an address is logged: the request, the Referer a page sends with its assets, and the Location of a
    // redirect.
    for (const field of ['request>uri', 'request>headers>Referer', 'resp_headers>Location'])
      expect(format, field).toMatch(new RegExp(`^\\s*import redact_query ${field}$`, 'm'))
    // The access log of :8080 and the error log (Caddy writes the whole request there when an upstream does not answer,
    // X-Setup-Token header included) use that one format. The default logger drops what the error log takes.
    expect(code).toMatch(/^\s*log error_log \{\n\s+include http\.log\.error\n\s+import log_format\n\s+\}/m)
    expect(code.slice(code.indexOf(':8080 {'), code.indexOf('handle @unnormalized'))).toMatch(
      /^\s*log \{\n\s+import log_format\n\s+\}/m,
    )
  })

  it('redacts every query value except the safe names, with the three regexp steps run the way Caddy runs them', () => {
    const code = withoutComments(caddyfile)
    const steps = [
      ...code.slice(code.indexOf('(redact_query) {')).matchAll(/\{args\[0\]\} regexp "([^"]+)" "([^"]+)"/g),
    ].map((match) => ({ pattern: new RegExp(match[1] ?? '', 'g'), replacement: match[2] ?? '' }))
    expect(steps).toHaveLength(3)
    // Go's regexp and JavaScript's agree on these patterns and on `$1`-style replacements.
    const redact = (address: string): string =>
      steps.reduce((text, step) => text.replace(step.pattern, step.replacement), address)
    const names = ['token', 'password', 'secret', 'signature', 'state', 'access_token', 'key', 'code']
    const unsafe = names.map((name) => `${name}=CANARY_${name}`).join('&')
    const out = redact(`/x?${unsafe}&action=rp&loggedout=true&checkemail=confirm&other=CANARY_other`)
    expect(out).not.toContain('CANARY')
    for (const name of names) expect(out, name).toContain(`${name}=REDACTED`)
    expect(out).toContain('other=REDACTED')
    expect(out).toContain('action=rp&loggedout=true&checkemail=confirm')
    // A name that imitates the mark is redacted too, not skipped; encodings and `;` hide nothing; a value up to `#` goes.
    expect(redact('/x?action~y=CANARY')).toBe('/x?action=y=REDACTED')
    expect(redact('/x?%74oken=CANARY&a=1;token=CANARY')).toBe('/x?%74oken=REDACTED&a=REDACTED')
    expect(redact('/admin/setup?token=CANARY#frag')).toBe('/admin/setup?token=REDACTED#frag')
    expect(redact('/x?action=rp&token=CANARY&action=lostpassword')).toBe(
      '/x?action=rp&token=REDACTED&action=lostpassword',
    )
    // The two lists of safe names are the same.
    const lists = [...code.matchAll(/\(([a-z|]+)\)[=~]/g)].map((match) => match[1])
    expect(lists).toHaveLength(2)
    expect(lists[0]).toBe(lists[1])
  })

  it('keeps TLS out of the stack', () => {
    expect(caddyfile).toContain('auto_https off')
    expect(caddyfile).toContain('admin off')
  })
})

describe('docker/mailpit', () => {
  it('builds Mailpit from a commit, not from a movable tag', () => {
    expect(mailpitDockerfile).toMatch(/ARG MAILPIT_COMMIT=[0-9a-f]{40}\n/)
    expect(mailpitDockerfile).toMatch(/^FROM golang:[0-9.]+-alpine[0-9.]+@sha256:[0-9a-f]{64} AS build$/m)
  })

  it('builds without VCS data, so the scanner reads the release, not a pseudo-version', () => {
    expect(mailpitDockerfile).toContain('-buildvcs=false')
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

describe('docker/postgres/entrypoint.sh', () => {
  // The entrypoint is the first thing the container runs: with a password missing it must stop before it reaches the
  // official entrypoint (which makes the data directory), and name the variable. A stand-in docker-entrypoint.sh on PATH
  // shows when the check let the start through.
  function run(env: Record<string, string>, args: string[]) {
    const dir = mkdtempSync(join(tmpdir(), 'toascribe-entrypoint-'))
    try {
      writeFileSync(join(dir, 'docker-entrypoint.sh'), '#!/bin/sh\necho "official entrypoint: $*"\n')
      chmodSync(join(dir, 'docker-entrypoint.sh'), 0o755)
      const script = join(dir, 'toascribe-entrypoint.sh')
      writeFileSync(script, postgresEntrypoint)
      const result = spawnSync('sh', [script, ...args], {
        env: { PATH: `${dir}:/usr/bin:/bin`, ...env },
        encoding: 'utf8',
      })
      return { code: result.status, stdout: result.stdout, stderr: result.stderr }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  const all = { POSTGRES_PASSWORD: 'a', POSTGRES_OWNER_PASSWORD: 'b', POSTGRES_APP_PASSWORD: 'c' }

  it.each(Object.keys(all))('refuses to start the server when %s is empty, and names it', (name) => {
    const result = run({ ...all, [name]: '' }, ['postgres'])
    expect(result.code).toBe(1)
    expect(result.stdout).not.toContain('official entrypoint')
    expect(result.stderr).toContain(`toascribe-postgres: ${name} is empty`)
    expect(result.stderr).toContain('toa core gen-env')
  })

  it('refuses when a password is not set at all', () => {
    const result = run({}, ['postgres'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('POSTGRES_PASSWORD is empty')
  })

  it('hands over to the official entrypoint, with the same arguments, when all three are set', () => {
    const result = run(all, ['postgres', '-c', 'log_statement=none'])
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe('official entrypoint: postgres -c log_statement=none')
  })

  it('leaves other commands alone, so `docker run IMAGE psql ...` needs no passwords', () => {
    const result = run({}, ['psql', '--version'])
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe('official entrypoint: psql --version')
  })

  it('is the image entrypoint, run before the official one', () => {
    expect(postgresDockerfile).toContain(
      'COPY --chmod=0555 docker/postgres/entrypoint.sh /usr/local/bin/toascribe-entrypoint.sh',
    )
    expect(postgresDockerfile).toContain('ENTRYPOINT ["toascribe-entrypoint.sh"]')
    expect(postgresDockerfile).toContain('CMD ["postgres"]')
  })
})

describe('the release workflow', () => {
  const build = job(releaseWorkflow, 'build')
  const publish = job(releaseWorkflow, 'publish')
  const release = job(releaseWorkflow, 'release')
  const workflows = [releaseWorkflow, auditWorkflow]

  it('runs on a v* tag and on a manual run with a tag, never on a branch push or a pull request', () => {
    expect(releaseWorkflow).toMatch(/^on:\n {2}push:\n {4}tags: \['v\*'\]\n {2}workflow_dispatch:\n/m)
    expect(releaseWorkflow).toMatch(/inputs:\n\s+tag:\n/)
    for (const workflow of workflows) {
      expect(withoutComments(workflow)).not.toMatch(/^\s+branches:/m)
      expect(withoutComments(workflow)).not.toMatch(/pull_request|workflow_run|workflow_call/)
    }
    expect(auditWorkflow).toMatch(/^on:\n {2}schedule:\n[^\n]+\n {2}workflow_dispatch:\n\n/m)
  })

  it('has no other workflows: the checks before a tag are local', () => {
    const dir = fileURLToPath(new URL('.github/workflows/', ROOT))
    expect(readdirSync(dir).sort()).toEqual(['audit.yml', 'release.yml'])
  })

  it('runs every job on GitHub runners, written out, never a self-hosted runner variable', () => {
    for (const workflow of workflows) {
      const runsOn = [...workflow.matchAll(/^\s+runs-on: (.+)$/gm)].map((match) => match[1])
      expect(runsOn.length).toBeGreaterThan(0)
      for (const value of runsOn) expect(value?.split(' #')[0]).toBe('ubuntu-latest')
      expect(withoutComments(workflow)).not.toContain('vars.')
      expect(withoutComments(workflow)).not.toContain('self-hosted')
    }
  })

  it('gives packages: write to publish only and contents: write to release only', () => {
    expect(releaseWorkflow).toMatch(/^permissions:\n {2}contents: read\n/m)
    expect(auditWorkflow).toMatch(/^permissions:\n {2}contents: read\n/m)
    expect(withoutComments(releaseWorkflow).match(/packages: write/g)).toHaveLength(1)
    expect(withoutComments(releaseWorkflow).match(/contents: write/g)).toHaveLength(1)
    expect(withoutComments(auditWorkflow)).not.toContain('write')
    expect(publish).toContain('packages: write')
    expect(release).toContain('contents: write')
    expect(withoutComments(build)).not.toContain('write')
  })

  it('runs no third-party code where a token can write', () => {
    for (const text of [publish, release]) {
      const uses = [...text.matchAll(/^\s+(?:- )?uses: (\S+)/gm)].map((match) => match[1] ?? '')
      for (const action of uses) expect(action).toMatch(/^actions\/(checkout|download-artifact)@[0-9a-f]{40}$/)
      expect(text).not.toMatch(/pnpm|npm |npx|docker (run|build|compose)|bake/)
    }
    // The only step that sees the package token is the login, through env and standard input.
    expect(releaseWorkflow.match(/secrets\.GITHUB_TOKEN/g)).toHaveLength(1)
    expect(publish).toContain('docker login ghcr.io --username "${ACTOR}" --password-stdin')
  })

  it('checks the tag before it builds, and checks out the tag', () => {
    expect(build).toContain('^v[0-9]+\\.[0-9]+\\.[0-9]+(-rc\\.[0-9]+)?$')
    expect(build).toContain('ref: refs/tags/${{ steps.tag.outputs.tag }}')
    expect(build).toContain('VERSION_FILE: package.json')
    expect(build.indexOf('scripts/check-release-tag.sh')).toBeGreaterThan(-1)
    expect(build.indexOf('scripts/check-release-tag.sh')).toBeLessThan(build.indexOf('uses: docker/'))
  })

  it('scans every digest, then writes the layout right before the upload', () => {
    expect(build).toContain('TOASCRIBE_REGISTRY: localhost:5000/toaweb-development')
    expect(build).toContain('*.attest=type=provenance,mode=max')
    expect(build).toContain('*.attest=type=sbom')
    expect(build).toMatch(/registry:3\.\d+\.\d+@sha256:[0-9a-f]{64}/)
    const digests = build.indexOf('scripts/image-digests.sh localhost:5000/toaweb-development')
    const exported = build.indexOf(
      'scripts/export-images.sh localhost:5000/toaweb-development "${RUNNER_TEMP}/images" "${DIGESTS}"',
    )
    const upload = build.indexOf('uses: actions/upload-artifact@')
    expect(digests).toBeGreaterThan(-1)
    expect(exported).toBeGreaterThan(digests)
    expect(upload).toBeGreaterThan(exported)
    // No other action runs between writing the layout and uploading it.
    expect(build.slice(exported, upload)).not.toMatch(/^\s+(?:- )?uses: /m)
    for (const name of ['api', 'site', 'admin', 'proxy', 'postgres', 'mailpit']) {
      const scan = build.indexOf(
        `image-ref: localhost:5000/toaweb-development/toascribe-${name}@\${{ fromJSON(steps.digests.outputs.digests).${name} }}`,
      )
      expect(scan, name).toBeGreaterThan(digests)
      expect(scan, name).toBeLessThan(exported)
      for (const script of [digestsScript, exportImagesScript, publishImagesScript]) expect(script).toContain(name)
    }
  })

  it('reads no build or Trivy cache that another run could have written', () => {
    expect(withoutComments(releaseWorkflow)).not.toMatch(/type=gha|actions\/cache/)
    const scans = build.match(/uses: aquasecurity\/trivy-action@/g) ?? []
    expect(scans).toHaveLength(6)
    expect(build.match(/^\s+cache: 'false'$/gm)).toHaveLength(6)
  })

  it('scans with the Trivy version that release:check installs', () => {
    const pinned = /^TRIVY_VERSION=(\S+)$/m.exec(read('scripts/install-tools.sh'))?.[1]
    expect(pinned).toBeDefined()
    expect(build.match(/^\s+version: (\S+)$/gm)).toEqual(Array(6).fill(`          version: v${String(pinned)}`))
  })

  it('scans with the same rules here and in release:check', () => {
    const rules = [
      ...build.matchAll(/scanners: (\S+)\n\s+severity: (\S+)\n\s+ignore-unfixed: (\S+)\n\s+exit-code: '(\d)'/g),
    ]
    expect(rules).toHaveLength(6)
    for (const rule of rules) expect(rule.slice(1).join('|')).toBe('vuln|CRITICAL,HIGH|true|1')
    expect(releaseCheck).toContain('--scanners vuln --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1')
  })

  it('hands the scanned images to publish by artifact id and digests, and publish checks both', () => {
    expect(build).toContain('artifact-id: ${{ steps.upload.outputs.artifact-id }}')
    expect(build).toContain('digests: ${{ steps.digests.outputs.digests }}')
    expect(publish).toContain('needs: build')
    expect(publish).toContain('artifact-ids: ${{ needs.build.outputs.artifact-id }}')
    expect(publish).not.toMatch(/^\s+name: images/m)
    expect(publish).toContain('digest-mismatch: error')
    expect(publish).toContain('DIGESTS: ${{ needs.build.outputs.digests }}')
    expect(publish).toContain(
      'scripts/publish-images.sh "${RUNNER_TEMP}/images" ghcr.io/toaweb-development "${VERSION}" "sha-${SHA::7}" "${DIGESTS}"',
    )
    expect(publish).toContain('ref: ${{ needs.build.outputs.sha }}')
  })

  it('copies by digest, checks the layout and the target, and never overwrites a version', () => {
    expect(exportImagesScript).toContain('"${source_prefix}/toascribe-${name}@${digest}"')
    expect(exportImagesScript).toContain('"${got}" != "${digest}"')
    expect(publishImagesScript).toContain('^sha256:[0-9a-f]{64}$')
    // Every blob is hashed before anything is pushed: a blob's file name is only a claim.
    const hashed = publishImagesScript.indexOf('"$(sha256sum <"${blob}" | cut -c1-64)" != "$(basename "${blob}")"')
    expect(hashed).toBeGreaterThan(-1)
    expect(hashed).toBeLessThan(publishImagesScript.indexOf('docker buildx imagetools create'))
    expect(publishImagesScript).toContain('"${in_layout}" != "${want}"')
    expect(publishImagesScript).toContain('"oci-layout://${layout}@${want}"')
    expect(publishImagesScript).toContain('"${got}" != "${want}"')
    expect(publishImagesScript).toContain('not overwritten')
    for (const script of [exportImagesScript, publishImagesScript]) {
      expect(script).not.toMatch(/docker (buildx )?(build|bake)\b/)
    }
  })

  it('makes the GitHub Release after the images, not for an -rc tag, with the CHANGELOG section', () => {
    expect(release).toContain('needs: [build, publish]')
    expect(release).toContain("if: ${{ !contains(needs.build.outputs.tag, '-rc.') }}")
    expect(release).toContain('scripts/release-notes.sh "${TAG}"')
    expect(release).toContain('gh release create "${TAG}" --verify-tag')
  })

  it('does not leave the token in a checkout', () => {
    for (const workflow of workflows) {
      const checkouts = [
        ...workflow.matchAll(/uses: actions\/checkout@[0-9a-f]{40} # v[0-9.]+\n\s+with:\n((?:\s+[a-z-]+: .+\n)+)/g),
      ]
      expect(checkouts.length).toBe(workflow.match(/uses: actions\/checkout@/g)?.length)
      for (const checkout of checkouts) expect(checkout[1]).toContain('persist-credentials: false')
    }
  })

  it('takes event values through env, never inline in a script', () => {
    for (const workflow of workflows) {
      for (const script of runScripts(workflow)) expect(script).not.toContain('${{')
      for (const line of workflow.matchAll(/^\s+(?:- )?run: (?!\|)(.+)$/gm)) expect(line[1]).not.toContain('${{')
    }
  })

  it('pins every third-party action to a commit SHA with its version', () => {
    for (const workflow of workflows) {
      const uses = [...workflow.matchAll(/^\s+(?:- )?uses: (\S+)(.*)$/gm)]
      expect(uses.length).toBeGreaterThan(0)
      for (const [, action, comment] of uses) {
        expect(action).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/)
        expect(comment).toMatch(/^ # v\d+\.\d+\.\d+$/)
      }
    }
  })
})

describe('the local release gate', () => {
  it('can run every script in scripts/', () => {
    const dir = fileURLToPath(new URL('scripts/', ROOT))
    const files = readdirSync(dir).filter((name) => name.endsWith('.sh'))
    expect(files.length).toBeGreaterThanOrEqual(8)
    for (const name of files) expect(statSync(join(dir, name)).mode & 0o111, name).not.toBe(0)
  })

  it('is one command', () => {
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts
    expect(scripts['release:check']).toBe('scripts/release-check.sh')
  })

  it('does everything the old CI did', () => {
    for (const part of [
      'actionlint',
      'scripts/audit.sh',
      'TEST_DATABASE_URL=',
      'MAILPIT_URL=',
      'pnpm check',
      'docker buildx bake',
      "--set '*.attest=type=provenance,mode=max' --set '*.attest=type=sbom'",
      'scripts/image-digests.sh',
      'trivy image',
      'scripts/export-images.sh',
      'scan "${valkey_image}"',
      'scripts/check-routes.sh before',
      'toa core install',
      '--admin-password-stdin',
      'scripts/check-routes.sh after',
      'scripts/publish-images.sh',
      'apps/admin/e2e/stack.sh up',
      'pnpm test:e2e',
    ]) {
      expect(releaseCheck, part).toContain(part)
    }
  })

  it('fails clearly without trivy or actionlint, and checks only what is committed', () => {
    expect(releaseCheck).toMatch(/for tool in [^\n]*\btrivy\b[^\n]*\bactionlint\b/)
    expect(releaseCheck).toContain('git status --porcelain')
    expect(releaseCheck).toContain('trap cleanup EXIT')
  })

  it('scans valkey at the digest compose.yaml runs', () => {
    const inCompose = /valkey\/valkey:[^\s@]+@sha256:[0-9a-f]{64}/.exec(compose)?.[0]
    expect(inCompose).toBeDefined()
    expect(releaseCheck).toContain(`valkey_image='${String(inCompose)}'`)
  })

  it('pins trivy and actionlint by version and sha256', () => {
    const install = read('scripts/install-tools.sh')
    expect(install).toMatch(/^TRIVY_VERSION=\d+\.\d+\.\d+\nTRIVY_SHA256=[0-9a-f]{64}$/m)
    expect(install).toMatch(/^ACTIONLINT_VERSION=\d+\.\d+\.\d+\nACTIONLINT_SHA256=[0-9a-f]{64}$/m)
    expect(install).toContain('sha256sum --check')
  })
})
