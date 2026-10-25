import { describe, expect, it } from 'vitest'

import {
  inlineContentSchema,
  inlineText,
  isSafeHref,
  isSafeMediaUrl,
  joinInline,
  normalizeInline,
} from '../src/index.ts'

describe('isSafeHref', () => {
  it.each(['https://example.com/a?b#c', 'http://example.com', 'mailto:kari@example.no', '/om-oss', '#avsnitt'])(
    'allows %s',
    (href) => {
      expect(isSafeHref(href)).toBe(true)
    },
  )

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '//evil.example/x',
    '/\\evil.example',
    'https://',
    'relative/path',
    '',
    `https://example.com/${'a'.repeat(2048)}`,
  ])('refuses %j', (href) => {
    expect(isSafeHref(href)).toBe(false)
  })

  it('takes neither a fragment nor mailto: as an image address', () => {
    expect(isSafeMediaUrl('https://example.com/a.png')).toBe(true)
    expect(isSafeMediaUrl('/api/v1/prototype/editor/uploads/x.png')).toBe(true)
    expect(isSafeMediaUrl('#a')).toBe(false)
    expect(isSafeMediaUrl('mailto:a@b.no')).toBe(false)
    expect(isSafeMediaUrl('data:image/png;base64,AAAA')).toBe(false)
  })
})

describe('inline content (the allow-list for rich text)', () => {
  const schema = inlineContentSchema(20)

  it('takes text with bold, italic, code and safe links, and hard breaks', () => {
    const content = [
      { type: 'text', text: 'Hei ', marks: [{ type: 'bold' }, { type: 'italic' }] },
      { type: 'text', text: 'lenke', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
      { type: 'hardBreak' },
      { type: 'text', text: 'x', marks: [{ type: 'code' }] },
    ]
    expect(schema.parse(content)).toEqual(content)
  })

  it.each([
    ['an HTML node', [{ type: 'html', html: '<script>alert(1)</script>' }]],
    ['an unknown mark', [{ type: 'text', text: 'a', marks: [{ type: 'underline' }] }]],
    ['a style attribute on a mark', [{ type: 'text', text: 'a', marks: [{ type: 'bold', attrs: { style: 'x' } }] }]],
    [
      'a javascript: link',
      [{ type: 'text', text: 'a', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }],
    ],
    [
      'a link with target',
      [{ type: 'text', text: 'a', marks: [{ type: 'link', attrs: { href: '/', target: '_blank' } }] }],
    ],
    ['an extra key on a text node', [{ type: 'text', text: 'a', onclick: 'x' }]],
    ['empty text', [{ type: 'text', text: '' }]],
    ['the same mark twice', [{ type: 'text', text: 'a', marks: [{ type: 'bold' }, { type: 'bold' }] }]],
    ['code with another mark', [{ type: 'text', text: 'a', marks: [{ type: 'code' }, { type: 'bold' }] }]],
    ['too much text', [{ type: 'text', text: 'a'.repeat(21) }]],
    ['a string instead of nodes', '<b>a</b>'],
  ])('refuses %s', (_name, content) => {
    expect(schema.safeParse(content).success).toBe(false)
  })

  it('normalises TipTap JSON: drops what is not allowed, keeps href only, joins equal runs', () => {
    expect(
      normalizeInline([
        { type: 'text', text: 'a', marks: [{ type: 'italic' }, { type: 'bold' }] },
        { type: 'text', text: 'b', marks: [{ type: 'bold' }, { type: 'italic' }] },
        {
          type: 'text',
          text: 'c',
          marks: [{ type: 'link', attrs: { href: 'https://x.no', target: '_blank', rel: 'noopener', class: null } }],
        },
        { type: 'text', text: 'd', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
        { type: 'image', attrs: { src: 'x' } },
        { type: 'hardBreak' },
        'junk',
      ]),
    ).toEqual([
      { type: 'text', text: 'ab', marks: [{ type: 'bold' }, { type: 'italic' }] },
      { type: 'text', text: 'c', marks: [{ type: 'link', attrs: { href: 'https://x.no' } }] },
      { type: 'text', text: 'd' },
      { type: 'hardBreak' },
    ])
    expect(normalizeInline(undefined)).toEqual([])
  })

  it('joins two runs and reads the plain text', () => {
    const joined = joinInline([{ type: 'text', text: 'Hei ' }], [{ type: 'text', text: 'du' }, { type: 'hardBreak' }])
    expect(joined).toEqual([{ type: 'text', text: 'Hei du' }, { type: 'hardBreak' }])
    expect(inlineText(joined)).toBe('Hei du\n')
  })
})
