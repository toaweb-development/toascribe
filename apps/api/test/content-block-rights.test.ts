// Who may use which block (M1.3, K-088): custom HTML only with unfiltered_html (the administrator by default; the editor has it not,
// Tor's decision in M0.3), checked on the server against the stored tree, so a request that skips the editor gets the same answer;
// someone without it may keep, move and delete a block that is there. «Les mer» only in posts.
import { ContentItem, InvalidBlocksResponse } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp, TestClient } from './harness.ts'

noticeIfSkipped('content block rights')

const paragraph = (id: string, text: string) => ({
  id,
  type: 'core/paragraph',
  version: 1,
  attrs: { content: [{ type: 'text', text }] },
  children: [],
})
const html = (id: string, content: string) => ({ id, type: 'core/html', version: 1, attrs: { content }, children: [] })
const more = (id: string) => ({ id, type: 'core/more', version: 1, attrs: {}, children: [] })

describe.skipIf(TEST_DATABASE_URL === undefined)('block rights (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let admin: TestClient
  let editor: TestClient

  beforeAll(async () => {
    env = await startAuthApp()
    await env.createAccount({ username: 'br-admin', role: 'administrator' })
    await env.createAccount({ username: 'br-editor', role: 'editor' })
    admin = env.client({ ip: '203.0.113.41' })
    editor = env.client({ ip: '203.0.113.42' })
    expect((await admin.login('br-admin', TEST_PASSWORD)).status).toBe(200)
    expect((await editor.login('br-editor', TEST_PASSWORD)).status).toBe(200)
  })

  afterAll(async () => {
    await env.close()
  })

  async function issues(res: Response): Promise<string[]> {
    expect(res.status).toBe(400)
    const body = InvalidBlocksResponse.parse(await res.json())
    return body.issues.map((issue) => `${issue.code}@${issue.path.join('.')}`)
  }

  it('refuses custom HTML from an account without unfiltered_html, also straight through the API', async () => {
    const res = await editor.post('/api/v1/content', {
      type: 'post',
      title: 'Med skript',
      blocks: [html('b_html0001', '<script>alert(1)</script>')],
    })
    expect(await issues(res)).toEqual(['capability_required@0.type'])
  })

  it('lets an editor keep, move and delete an administrator’s HTML block, but not change or copy it', async () => {
    const made = await admin.post('/api/v1/content', {
      type: 'post',
      title: 'Innbygd kart',
      blocks: [paragraph('b_para0001', 'Kart:'), html('b_html0002', '<iframe src="https://kart.example"></iframe>')],
    })
    expect(made.status).toBe(201)
    const post = ContentItem.parse(await made.json())
    const url = `/api/v1/content/${post.id}`
    // Moved above the paragraph, unchanged: allowed.
    const moved = await editor.patch(url, {
      blocks: [html('b_html0002', '<iframe src="https://kart.example"></iframe>'), paragraph('b_para0001', 'Kart:')],
    })
    expect(moved.status).toBe(200)
    // Changed: refused.
    expect(
      await issues(await editor.patch(url, { blocks: [html('b_html0002', '<img src=x onerror=alert(1)>')] })),
    ).toEqual(['capability_required@0.type'])
    // Copied under a new id: refused, even with the same content.
    expect(
      await issues(
        await editor.patch(url, {
          blocks: [
            html('b_html0002', '<iframe src="https://kart.example"></iframe>'),
            html('b_html0003', '<iframe src="https://kart.example"></iframe>'),
          ],
        }),
      ),
    ).toEqual(['capability_required@1.type'])
    // Deleted: allowed.
    expect((await editor.patch(url, { blocks: [paragraph('b_para0001', 'Kart:')] })).status).toBe(200)
    // The administrator may change it again.
    expect((await admin.patch(url, { blocks: [html('b_html0004', '<p>ny</p>')] })).status).toBe(200)
  })

  it('takes «Les mer» in a post, not in a page', async () => {
    expect(
      (
        await editor.post('/api/v1/content', {
          type: 'post',
          title: 'Lang',
          blocks: [paragraph('b_para0005', 'Ingress'), more('b_more0001'), paragraph('b_para0006', 'Resten')],
        })
      ).status,
    ).toBe(201)
    const page = await editor.post('/api/v1/content', {
      type: 'page',
      title: 'Side',
      blocks: [paragraph('b_para0007', 'Ingress'), more('b_more0002')],
    })
    expect(await issues(page)).toEqual(['wrong_content_type@1.type'])
  })
})
