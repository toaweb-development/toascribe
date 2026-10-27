// WordPress' parsed blocks as toascribe blocks (M1.4): the HTML of a block as rich text data (entities, marks, links that are allowed,
// line breaks), each block type the default content and a plain WordPress post use, and a tree with an unknown block left alone.
import { describe, expect, it } from 'vitest'

import type { WordPressBlock } from '../src/index.ts'
import {
  createBlock,
  decodeEntities,
  fromWordPress,
  inlineFromHtml,
  isWordPressTree,
  validateDocument,
} from '../src/index.ts'

const wp = (blockName: string, innerHTML: string, attrs = {}, innerBlocks: WordPressBlock[] = []): WordPressBlock => ({
  blockName,
  attrs,
  innerBlocks,
  innerHTML,
})

describe('inline HTML as rich text', () => {
  it('reads bold, italic, code, links and line breaks, and decodes entities', () => {
    expect(inlineFromHtml('Hei <strong>fet</strong> og <em>kursiv &amp; mer</em><br>ny linje')).toEqual([
      { type: 'text', text: 'Hei ' },
      { type: 'text', text: 'fet', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' og ' },
      { type: 'text', text: 'kursiv & mer', marks: [{ type: 'italic' }] },
      { type: 'hardBreak' },
      { type: 'text', text: 'ny linje' },
    ])
    expect(inlineFromHtml('<a href="https://example.no/?a=1&amp;b=2">lenke</a>')).toEqual([
      { type: 'text', text: 'lenke', marks: [{ type: 'link', attrs: { href: 'https://example.no/?a=1&b=2' } }] },
    ])
  })

  it('keeps the text of a link it may not keep, and of tags it does not know', () => {
    expect(inlineFromHtml('<a href="javascript:alert(1)">klikk</a> <span class="x">tekst</span>')).toEqual([
      { type: 'text', text: 'klikk tekst' },
    ])
    expect(inlineFromHtml('<img src=x onerror=alert(1)>etter')).toEqual([{ type: 'text', text: 'etter' }])
  })

  it('decodes named and numeric entities, and leaves an unknown one as it is', () => {
    expect(decodeEntities('&laquo;Husk meg&raquo; &#8211; &#x2014; &ukjent;')).toBe('«Husk meg» – — &ukjent;')
  })
})

describe('what a damaged or hostile post cannot do', () => {
  it('takes linear time on a long run of spaces in an open tag', () => {
    const started = performance.now()
    inlineFromHtml(`x<a${' '.repeat(20_000)}y`)
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('never makes a lone surrogate from a numeric entity, and the schema refuses one', () => {
    expect(decodeEntities('&#xD800;&#55296;&#0;&#x110000;')).toBe('\ufffd\ufffd\ufffd\ufffd')
    expect(fromWordPress([wp('core/paragraph', '<p>a&#xDC00;b</p>')])?.[0]?.attrs['content']).toEqual([
      { type: 'text', text: 'a\ufffdb' },
    ])
    expect(
      validateDocument([{ ...createBlock('core/paragraph'), attrs: { content: [{ type: 'text', text: '\ud800' }] } }])
        .ok,
    ).toBe(false)
  })

  it('marks a run once when the same mark is nested, and keeps the innermost link', () => {
    expect(inlineFromHtml('<strong><b>fet</b></strong> <a href="/a"><a href="/b">lenke</a></a>')).toEqual([
      { type: 'text', text: 'fet', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'lenke', marks: [{ type: 'link', attrs: { href: '/b' } }] },
    ])
  })

  it('drops comments and what a script or a style holds', () => {
    expect(inlineFromHtml('a<!-- skjult -->b<script>alert(1)</script>c<style>p{}</style>d')).toEqual([
      { type: 'text', text: 'abcd' },
    ])
  })

  it('converts nothing for a node of the wrong shape, or a list item with two nested lists', () => {
    const broken = [
      { blockName: 'core/quote', attrs: {}, innerHTML: '<blockquote></blockquote>', innerBlocks: [{ blockName: 'x' }] },
    ]
    expect(fromWordPress(broken as never)).toBeUndefined()
    const twoLists = wp('core/list', '<ul></ul>', {}, [
      wp('core/list-item', '<li>a</li>', {}, [
        wp('core/list', '<ul></ul>', {}, [wp('core/list-item', '<li>b</li>')]),
        wp('core/list', '<ul></ul>', {}, [wp('core/list-item', '<li>c</li>')]),
      ]),
    ])
    expect(fromWordPress([twoLists])).toBeUndefined()
  })
})

describe('WordPress blocks as toascribe blocks', () => {
  it('converts the blocks of the default content and of a plain post', () => {
    const blocks =
      fromWordPress([
        wp('core/paragraph', '\n<p>Velkommen til <a href="/admin/">kontrollpanelet</a>.</p>\n'),
        wp('core/heading', '\n<h3 class="wp-block-heading">Hvem vi er</h3>\n', { level: 3 }),
        wp('core/quote', '\n<blockquote class="wp-block-quote">\n\n<cite>Noen</cite></blockquote>\n', {}, [
          wp('core/paragraph', '\n<p>Sitert</p>\n'),
        ]),
        wp('core/list', '<ul></ul>', { ordered: true }, [
          wp('core/list-item', '<li>Ett</li>'),
          wp('core/list-item', '<li>To</li>'),
        ]),
        wp('core/separator', '<hr class="wp-block-separator"/>'),
        wp('core/code', '<pre class="wp-block-code"><code>if (a &lt; b)</code></pre>'),
        wp('core/more', '<!--more-->', { customText: 'Les videre' }),
        { blockName: null, attrs: {}, innerBlocks: [], innerHTML: '\n\n' },
      ]) ?? []
    expect(blocks.map((block) => block.type)).toEqual([
      'core/paragraph',
      'core/heading',
      'core/quote',
      'core/list',
      'core/separator',
      'core/code',
      'core/more',
    ])
    expect(blocks[0]?.attrs['content']).toEqual([
      { type: 'text', text: 'Velkommen til ' },
      { type: 'text', text: 'kontrollpanelet', marks: [{ type: 'link', attrs: { href: '/admin/' } }] },
      { type: 'text', text: '.' },
    ])
    expect(blocks[1]?.attrs).toMatchObject({ level: 3, content: [{ type: 'text', text: 'Hvem vi er' }] })
    expect(blocks[2]?.attrs['citation']).toEqual([{ type: 'text', text: 'Noen' }])
    expect(blocks[3]?.attrs['ordered']).toBe(true)
    expect(blocks[5]?.attrs['content']).toBe('if (a < b)')
    expect(blocks[6]?.attrs['customText']).toBe('Les videre')
  })

  it('converts nothing when a block type is unknown, and knows the WordPress form', () => {
    const tree = [wp('core/paragraph', '<p>x</p>'), wp('core/cover', '<div></div>')]
    expect(fromWordPress(tree)).toBeUndefined()
    expect(isWordPressTree(tree)).toBe(true)
    expect(isWordPressTree([{ id: 'b_aaaa', type: 'core/paragraph', version: 1, attrs: {}, children: [] }])).toBe(false)
  })
})
