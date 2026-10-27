// «Utseende → Tilpass» (M1.5, K-150, K-151): the theme's colours and fonts stored per theme, the identity as settings, «Ekstra CSS»
// that only edit_css may change and that can never end its <style>, and what the site reads.
import { CacheChanges, CustomizeResponse, PublicCustomizeResponse } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp, TestClient } from './harness.ts'

noticeIfSkipped('customize')

describe.skipIf(TEST_DATABASE_URL === undefined)('Tilpass (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let admin: TestClient
  let designer: TestClient
  let visitor: TestClient
  const patch = (client: TestClient, body: Record<string, unknown>) =>
    client.patch('/api/v1/customize', { theme: 'default', ...body })

  beforeAll(async () => {
    env = await startAuthApp()
    await env.createAccount({ username: 'cust-admin', role: 'administrator' })
    await env.createAccount({ username: 'cust-designer', role: 'editor' })
    // A role with edit_theme_options but not unfiltered_html: it may change the colours, not «Ekstra CSS».
    await env.query(
      `update role set capabilities = array_append(capabilities, 'edit_theme_options') where slug = 'editor'`,
    )
    admin = env.client({ ip: '203.0.113.111' })
    designer = env.client({ ip: '203.0.113.112' })
    visitor = env.client({ ip: '203.0.113.113' })
    expect((await admin.login('cust-admin', TEST_PASSWORD)).status).toBe(200)
    expect((await designer.login('cust-designer', TEST_PASSWORD)).status).toBe(200)
  })

  afterAll(async () => {
    await env.close()
  })

  it("stores a theme's colours, fonts and CSS for that theme, and the identity as settings", async () => {
    const res = await patch(admin, {
      identity: { blogname: 'Fjellbloggen', blogdescription: 'Turer og topper' },
      colors: { primary: '#0f766e' },
      fonts: { body: "Georgia, 'Times New Roman', serif" },
      customCss: '.theme-site-title > span { letter-spacing: 0.05em; }',
    })
    expect(res.status, await res.clone().text()).toBe(200)
    const body = CustomizeResponse.parse(await res.json())
    expect(body).toMatchObject({
      identity: { blogname: 'Fjellbloggen' },
      customization: { colors: { primary: '#0f766e' } },
    })
    expect(body.mayEditCss).toBe(true)
    // Another theme has its own.
    const other = CustomizeResponse.parse(await (await admin.get('/api/v1/customize?theme=annet')).json())
    expect(other.customization).toEqual({ colors: {}, fonts: {}, customCss: '' })

    const site = PublicCustomizeResponse.parse(
      await (await visitor.get('/api/v1/public/customize?theme=default')).json(),
    )
    expect(site.customization.customCss).toContain('letter-spacing')
    expect(site.customization.colors).toEqual({ primary: '#0f766e' })
  })

  it('refuses CSS that could end its <style>, and values that could leave their declaration', async () => {
    for (const body of [
      { customCss: 'a{}</style><script>alert(1)</script>' },
      { customCss: 'a{content:"\\3c/style>"}' },
      { customCss: 'a{content:"\\00003C"}' },
      { colors: { primary: 'red; } body { display: none' } },
      { fonts: { body: 'serif; } * { color: red' } },
      { identity: { site_logo: crypto.randomUUID() } },
    ]) {
      expect((await patch(admin, body)).status, JSON.stringify(body)).toBe(400)
    }
  })

  it('lets only edit_css (edit_theme_options and unfiltered_html) change «Ekstra CSS»', async () => {
    const answer = CustomizeResponse.parse(await (await designer.get('/api/v1/customize?theme=default')).json())
    expect(answer.mayEditCss).toBe(false)
    expect((await patch(designer, { colors: { primary: '#1d4ed8' } })).status).toBe(200)
    expect((await patch(designer, { customCss: 'body { color: red }' })).status).toBe(403)
    // Sending the stored CSS back unchanged is no change.
    expect((await patch(designer, { customCss: answer.customization.customCss })).status).toBe(200)
    expect((await visitor.get('/api/v1/customize?theme=default')).status).toBe(401)
  })

  it("keeps «Generelt»'s title, tagline and icon at manage_options", async () => {
    const answer = CustomizeResponse.parse(await (await designer.get('/api/v1/customize?theme=default')).json())
    expect(answer.mayEditIdentity).toBe(false)
    expect((await patch(designer, { identity: { blogname: 'Overtatt' } })).status).toBe(403)
    expect((await patch(designer, { identity: { blogdescription: 'Overtatt' } })).status).toBe(403)
    expect((await patch(designer, { identity: { site_icon: null, blogname: 'Overtatt' } })).status).toBe(403)
    // The same values sent back are no change, and the logo is the theme's (edit_theme_options).
    expect((await patch(designer, { identity: { ...answer.identity } })).status).toBe(200)
    expect((await patch(designer, { identity: { site_logo: null } })).status).toBe(200)
    expect(
      CustomizeResponse.parse(await (await admin.get('/api/v1/customize?theme=default')).json()).mayEditIdentity,
    ).toBe(true)
  })

  it("never takes the theme's version from the client", async () => {
    expect((await patch(admin, { version: '99.0.0', colors: { primary: '#0f766e' } })).status).toBe(400)
    expect((await patch(admin, { colors: { primary: '#0f766e' } })).status).toBe(200)
    const rows = await env.query(`select version from extension_state where kind = 'theme' and slug = 'default'`)
    expect(rows).toEqual([{ version: '' }])
  })

  it("clears the site's cache on a change", async () => {
    const start = CacheChanges.parse(await (await visitor.get('/api/v1/public/cache/changes')).json())
    expect((await patch(admin, { colors: { primary: '#7c3aed' } })).status).toBe(200)
    const changes = CacheChanges.parse(
      await (await visitor.get(`/api/v1/public/cache/changes?since=${start.cursor}`)).json(),
    )
    expect(changes.all).toBe(true)
  })
})
