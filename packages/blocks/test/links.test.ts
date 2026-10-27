import { describe, expect, it } from 'vitest'

import { createBlock, documentLinkRefs } from '../src/index.ts'

describe('the links of a document (content_ref, M1.4)', () => {
  it('finds links in rich text, in table cells and on buttons, once per block, with the block that holds each', () => {
    const link = (href: string, text: string) => ({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] })
    const paragraph = createBlock('core/paragraph', {
      content: [link('/om-oss/', 'Om'), { type: 'text', text: ' og ' }, link('/om-oss/', 'igjen')],
    })
    const button = createBlock('core/button', { url: 'https://example.no/', text: [{ type: 'text', text: 'Gå' }] })
    const buttons = createBlock('core/buttons', {}, [button])
    const table = createBlock('core/table', { cells: [[[link('mailto:a@example.no', 'Skriv')]]] })
    expect(documentLinkRefs([paragraph, buttons, table])).toEqual([
      { href: '/om-oss/', blockId: paragraph.id },
      { href: 'https://example.no/', blockId: button.id },
      { href: 'mailto:a@example.no', blockId: table.id },
    ])
  })
})
