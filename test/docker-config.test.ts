// Checks on the files a user downloads and runs (docker/compose.yaml, docker/.env.example) that a build or a
// type check cannot catch. The stack itself is proven by CI, which builds the images and runs `docker compose up`.
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
const ciWorkflow = read('.github/workflows/ci.yml')
const releaseWorkflow = read('.github/workflows/release.yml')
const buildScanAction = read('.github/actions/build-scan-images/action.yml')
const copyImagesScript = read('.github/scripts/copy-images.sh')
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
    const external = [...compose.matchAll(/^\s+image: (?!ghcr\.io\/toaweb\/)(\S+)/gm)].map((match) => match[1])
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

  it('builds mailpit here, on the official image that CI starts for the e-mail tests', () => {
    expect(service('mailpit')).toContain('image: ghcr.io/toaweb/toascribe-mailpit:')
    expect(service('mailpit')).toContain('dockerfile: docker/mailpit/Dockerfile')
    const pattern = /axllent\/mailpit:v[0-9.]+@sha256:[0-9a-f]{64}/
    const inDockerfile = pattern.exec(mailpitDockerfile)?.[0]
    expect(inDockerfile).toBeDefined()
    expect(ciWorkflow).toContain(String(inDockerfile))
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
      .replaceAll('${TOASCRIBE_REGISTRY:-ghcr.io/toaweb}', 'ghcr.io/toaweb')
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

  it('takes the registry from TOASCRIBE_REGISTRY, ghcr.io/toaweb by default', () => {
    const images = [...composeBuild.matchAll(/^\s+image: (\S+)$/gm)].map((match) => match[1])
    expect(images).toHaveLength(6)
    for (const image of images) expect(image).toMatch(/^\$\{TOASCRIBE_REGISTRY:-ghcr\.io\/toaweb\}\/toascribe-[a-z]+:/)
  })

  it('labels every image with the repository, which links the package in the registry to it', () => {
    expect(composeBuild.match(/^\s+labels: \*labels$/gm)).toHaveLength(6)
    expect(composeBuild).toContain('org.opencontainers.image.source: https://github.com/toaweb/toascribe')
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
  const images = job(releaseWorkflow, 'images')
  const release = job(releaseWorkflow, 'release')
  const plan = job(releaseWorkflow, 'plan')
  const dryRun = job(ciWorkflow, 'release-dry-run')

  it('gives packages: write to the job that publishes and to nothing else', () => {
    expect(withoutComments(releaseWorkflow).match(/packages: write/g)).toHaveLength(1)
    expect(images).toContain('packages: write')
    expect(plan).not.toContain('write')
    expect(release).not.toContain('packages:')
    // Neither workflow-level permissions nor a pull request run can write packages.
    expect(releaseWorkflow).toMatch(/^permissions:\n {2}contents: read\n/m)
    expect(ciWorkflow).toMatch(/^permissions:\n {2}contents: read\n/m)
    expect(withoutComments(ciWorkflow)).not.toContain('write')
    expect(withoutComments(buildScanAction)).not.toContain('write')
    expect(releaseWorkflow).not.toMatch(/^on:[\s\S]*pull_request/m)
  })

  it('gives contents: write to the tag and release job only', () => {
    expect(withoutComments(releaseWorkflow).match(/contents: write/g)).toHaveLength(1)
    expect(release).toContain('contents: write')
    expect(release).not.toContain('uses: docker/')
  })

  it('tags only after the images are published, and only when the tag does not exist', () => {
    expect(release).toMatch(/needs: \[plan, images\]/)
    expect(release).toContain("needs.plan.outputs.real == 'true'")
    expect(plan).toContain('git rev-parse -q --verify "refs/tags/${tag}"')
    expect(images).toContain("if: needs.plan.outputs.publish == 'true'")
    expect(release).toContain("needs.plan.outputs.publish == 'true'")
  })

  it('scans before the login, and logs in and pushes only in a real run', () => {
    const scan = images.indexOf('uses: ./.github/actions/build-scan-images')
    const login = images.indexOf('uses: docker/login-action@')
    const push = images.indexOf('copy-images.sh localhost:5000/toaweb ghcr.io/toaweb')
    expect(scan).toBeGreaterThan(-1)
    expect(login).toBeGreaterThan(scan)
    expect(push).toBeGreaterThan(login)
    for (const at of [login, push]) {
      expect(images.slice(images.lastIndexOf('- name:', at), at + 200)).toContain(
        "if: needs.plan.outputs.real == 'true'",
      )
    }
    // The login is the only step that sees the token.
    expect(releaseWorkflow.match(/secrets\.GITHUB_TOKEN/g)).toHaveLength(1)
  })

  it('cannot be a real run off main, and a dry run is the default of a manual run', () => {
    expect(releaseWorkflow).toMatch(/push:\n\s+description: [^\n]+\n\s+type: boolean\n\s+default: false/)
    expect(plan).toContain('"${REF}" != refs/heads/main')
  })

  it('does not leave the token in the checkout of the job that runs third-party code', () => {
    expect(images).toMatch(/actions\/checkout@[0-9a-f]{40} # v[0-9.]+\n\s+with:\n\s+persist-credentials: false/)
    expect(plan).toContain('persist-credentials: false')
  })

  it('takes event values through env, never inline in a script', () => {
    for (const workflow of [releaseWorkflow, buildScanAction, job(ciWorkflow, 'release-dry-run')]) {
      const scripts = runScripts(workflow)
      expect(scripts.length).toBeGreaterThan(0)
      for (const script of scripts) expect(script).not.toContain('${{')
    }
  })

  it('pins every third-party action to a commit SHA', () => {
    for (const workflow of [releaseWorkflow, ciWorkflow, buildScanAction]) {
      const uses = [...workflow.matchAll(/^\s+(?:- )?uses: (\S+)/gm)].map((match) => match[1] ?? '')
      expect(uses.length).toBeGreaterThan(0)
      for (const action of uses) {
        if (action.startsWith('./')) continue
        expect(action).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/)
      }
    }
  })

  it('builds all six images with provenance and SBOM into the local registry and scans each one there', () => {
    expect(buildScanAction).toContain('TOASCRIBE_REGISTRY: localhost:5000/toaweb')
    expect(buildScanAction).toContain('*.attest=type=provenance,mode=max')
    expect(buildScanAction).toContain('*.attest=type=sbom')
    expect(buildScanAction).toMatch(/driver-opts: network=host/)
    expect(buildScanAction).toMatch(/registry:3\.\d+\.\d+@sha256:[0-9a-f]{64}/)
    expect(buildScanAction).not.toContain('login-action')
    for (const name of ['api', 'site', 'admin', 'proxy', 'postgres', 'mailpit']) {
      expect(buildScanAction).toContain(`image-ref: localhost:5000/toaweb/toascribe-${name}:`)
      expect(copyImagesScript).toContain(name)
    }
  })

  it('scans with the rules of the image gate in ci.yml', () => {
    const rules = (text: string) =>
      [...text.matchAll(/scanners: (\S+)\n\s+severity: (\S+)\n\s+ignore-unfixed: (\S+)\n\s+exit-code: '(\d)'/g)].map(
        (match) => match.slice(1).join('|'),
      )
    const fromCi = rules(job(ciWorkflow, 'images'))
    const fromRelease = rules(buildScanAction)
    expect(fromRelease).toHaveLength(6)
    expect(fromCi.length).toBeGreaterThanOrEqual(6)
    for (const rule of [...fromCi, ...fromRelease]) expect(rule).toBe('vuln|CRITICAL,HIGH|true|1')
  })

  it('has a dry run on every pull request that uses the same action and script, and has no login', () => {
    expect(dryRun).toContain('uses: ./.github/actions/build-scan-images')
    expect(dryRun).toContain('.github/scripts/copy-images.sh localhost:5000/toaweb localhost:5001/toaweb')
    expect(dryRun).not.toContain('login-action')
    expect(dryRun).not.toContain('ghcr.io')
    expect(ciWorkflow).toMatch(/^on:\n {2}pull_request:\n/m)
  })

  it('copies the manifest list as it is and stops if a digest changes', () => {
    expect(copyImagesScript).toContain('docker buildx imagetools create')
    expect(copyImagesScript).toContain('"${got}" != "${want}"')
    expect(copyImagesScript).toContain('not overwritten')
    expect(copyImagesScript).not.toMatch(/docker (buildx )?build\b/)
  })
})
