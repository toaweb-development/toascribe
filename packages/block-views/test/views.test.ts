// @vitest-environment jsdom
// The views of the basic blocks (M1.3): for each block, the HTML the server renders from its JSON, what an empty block renders, that
// markup in the data stays text (a table cell, a caption, a button), and axe on the rendered HTML (WCAG 2.2 A and AA; colour contrast
// cannot be measured in jsdom and is checked in the browser by the e2e suite).
import axe from 'axe-core'
import { createSSRApp, defineComponent, h } from 'vue'
import type { PropType } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'

import type { Block, InlineNode } from '@toascribe/blocks'
import { createBlock, createInsertable, insertableBlocks, validateDocument } from '@toascribe/blocks'
import type { ContentMediaRef } from '@toascribe/shared'

import { BlockDocument } from '../src/index.ts'

const MEDIA_ID = '01a15f9a-26a2-73d3-8aad-c6b671836b33'
const PHOTO: ContentMediaRef = {
  id: MEDIA_ID,
  url: '/uploads/2026/10/fjord-abcdef01-0a0a0a0a-scaled.webp',
  width: 2560,
  height: 1707,
  alt: 'Fjord',
  mime: 'image/jpeg',
  sizes: [{ name: 'medium', width: 300, height: 200, url: '/uploads/2026/10/fjord-abcdef01-0a0a0a0a-300x200.webp' }],
}

const text = (
  value: string,
  marks?: InlineNode extends infer N ? (N extends { marks?: infer M } ? M : never) : never,
) => [marks === undefined ? { type: 'text', text: value } : { type: 'text', text: value, marks }] as InlineNode[]

/** The blocks as the server renders them, after the same check the api makes. */
async function render(blocks: Block[], media: ContentMediaRef[] = [PHOTO]): Promise<string> {
  const checked = validateDocument(JSON.parse(JSON.stringify(blocks)))
  expect(checked.ok ? [] : checked.issues).toEqual([])
  const app = createSSRApp({ render: () => h(BlockDocument, { blocks: checked.ok ? checked.blocks : [], media }) })
  return (await renderToString(app)).replace(/<!--\[-->|<!--]-->|<!---->/g, '')
}

/** axe on a page that holds the HTML (in a <main> with a title, as the site draws it). */
async function axeViolations(html: string): Promise<string[]> {
  document.documentElement.lang = 'nb'
  document.title = 'Test'
  document.body.innerHTML = `<main><h1>Innlegg</h1>${html}</main>`
  const result = await axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    rules: { 'color-contrast': { enabled: false } },
  })
  return result.violations.map(
    (violation) => `${violation.id}: ${violation.nodes.map((node) => node.html).join(' | ')}`,
  )
}

const p = (value: string) => createBlock('core/paragraph', { content: text(value) })
const image = (alt = 'En fjord en sommerkveld') => createBlock('core/image', { mediaId: MEDIA_ID, alt })
const item = (value: string, nested: Block[] = []) => createBlock('core/list-item', { content: text(value) }, nested)

/** Every basic block with content, each as its view must draw it. */
const CASES: [string, Block, RegExp][] = [
  [
    'paragraph',
    createBlock('core/paragraph', { content: text('Fet', [{ type: 'bold' }]) }),
    /^<p><strong>Fet<\/strong><\/p>$/,
  ],
  ['heading', createBlock('core/heading', { level: 2, content: text('Mellomtittel') }), /^<h2>Mellomtittel<\/h2>$/],
  [
    'list',
    createBlock('core/list', { ordered: true }, [
      item('En', [createBlock('core/list', {}, [item('Under')])]),
      item('To'),
    ]),
    /^<ol class="block-list"><li>En<ul class="block-list"><li>Under<\/li><\/ul><\/li><li>To<\/li><\/ol>$/,
  ],
  [
    'quote',
    createBlock('core/quote', { citation: text('Ibsen') }, [p('Til sjøs.')]),
    /^<blockquote class="block-quote"><p>Til sjøs\.<\/p><cite>Ibsen<\/cite><\/blockquote>$/,
  ],
  [
    'code',
    createBlock('core/code', { content: 'if (a < b) {\n  return "<b>"\n}' }),
    /^<pre class="block-code"><code>if \(a &lt; b\) \{\n {2}return &quot;&lt;b&gt;&quot;\n\}<\/code><\/pre>$/,
  ],
  [
    'preformatted',
    createBlock('core/preformatted', { content: [...text('Linje en'), { type: 'hardBreak' }, ...text('  to')] }),
    /^<pre class="block-preformatted">Linje en<br> {2}to<\/pre>$/,
  ],
  [
    'table',
    createBlock('core/table', {
      hasHeader: true,
      cells: [
        [text('By'), text('Folketall')],
        [text('Bergen'), text('<script>alert(1)</script>')],
      ],
      caption: 'Byer',
    }),
    /^<figure class="block-table"><table><thead><tr><th scope="col">By<\/th><th scope="col">Folketall<\/th><\/tr><\/thead><tbody><tr><td>Bergen<\/td><td>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/td><\/tr><\/tbody><\/table><figcaption>Byer<\/figcaption><\/figure>$/,
  ],
  [
    'image',
    image(),
    /^<figure class="block-image"><img src="\/uploads\/[^"]+-scaled\.webp" srcset="[^"]+-300x200\.webp 300w, [^"]+-scaled\.webp 2560w" sizes="[^"]+" width="2560" height="1707" alt="En fjord en sommerkveld" loading="lazy" decoding="async"><\/figure>$/,
  ],
  [
    'gallery',
    createBlock('core/gallery', { columns: 2, linkTo: 'file' }, [image(), image('En annen fjord')]),
    /^<figure class="block-gallery columns-2 is-cropped"><figure class="block-image"><a href="\/uploads\/[^"]+"><img [^>]*alt="En fjord en sommerkveld"[^>]*><\/a><\/figure><figure class="block-image"><a href="[^"]+"><img [^>]*alt="En annen fjord"[^>]*><\/a><\/figure><\/figure>$/,
  ],
  [
    'buttons',
    createBlock('core/buttons', {}, [
      createBlock('core/button', { text: text('Les mer'), url: '/om-oss' }),
      createBlock('core/button', { text: text('Uten lenke'), variant: 'outline' }),
    ]),
    /^<div class="block-buttons"><a class="block-button is-fill" href="\/om-oss">Les mer<\/a><span class="block-button is-outline">Uten lenke<\/span><\/div>$/,
  ],
  [
    'columns',
    createBlock('core/columns', {}, [
      createBlock('core/column', {}, [p('Venstre')]),
      createBlock('core/column', {}, [p('Høyre')]),
    ]),
    /^<div class="block-columns columns-2"><div class="block-column"><p>Venstre<\/p><\/div><div class="block-column"><p>Høyre<\/p><\/div><\/div>$/,
  ],
  ['group', createBlock('core/group', {}, [p('Inni')]), /^<div class="block-group"><p>Inni<\/p><\/div>$/],
  ['separator', createBlock('core/separator'), /^<hr class="block-separator">$/],
  [
    'spacer',
    createBlock('core/spacer', { size: 'large' }),
    /^<div class="block-spacer is-large" aria-hidden="true"><\/div>$/,
  ],
  ['more', createBlock('core/more'), /^$/],
  ['nextpage', createBlock('core/nextpage'), /^$/],
  // The site draws it with the items it reads (site-core's view, M1.4); here, without data, it shows nothing.
  ['query', createBlock('core/query'), /^$/],
  [
    'html',
    createBlock('core/html', { content: '<p class="egen">Rå</p>' }),
    /^<pre class="block-html is-source"><code>&lt;p class=&quot;egen&quot;&gt;Rå&lt;\/p&gt;<\/code><\/pre>$/,
  ],
]

describe('the view of each basic block', () => {
  it.each(CASES)('%s: renders its data as HTML', async (_name, block, expected) => {
    const html = await render([block])
    expect(html.replace(/^<div class="blocks">|<\/div>$/g, '')).toMatch(expected)
  })

  it.each(CASES)('%s: passes axe', async (_name, block) => {
    expect(await axeViolations(await render([block]))).toEqual([])
  })

  it('covers every block the inserter offers', () => {
    const named = new Set(CASES.map(([, block]) => block.type))
    for (const definition of insertableBlocks(null)) expect(named, definition.name).toContain(definition.name)
  })
})

describe('an empty block', () => {
  it.each(insertableBlocks(null).map((definition) => definition.name))(
    '%s as the inserter puts it in',
    async (type) => {
      const html = await render([createInsertable(type)], [])
      expect(html.startsWith('<div class="blocks">')).toBe(true)
      expect(await axeViolations(html)).toEqual([])
    },
  )

  it('an image without a file, or whose file is gone, shows nothing', async () => {
    expect(await render([createBlock('core/image')], [])).toBe('<div class="blocks"></div>')
    expect(await render([image()], [])).toBe('<div class="blocks"></div>')
  })
})

describe('custom HTML', () => {
  const block = createBlock('core/html', { content: '<script>alert(1)</script><p onclick="x()">Rå</p>' })

  it('is shown as its source by default, so no script in it can run (the admin never asks for raw)', async () => {
    const html = await render([block])
    expect(html).not.toMatch(/<script|<p onclick/)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('is written as markup only when the caller asks for raw (the public site, M1.4)', async () => {
    const app = createSSRApp({ render: () => h(BlockDocument, { blocks: [block], html: 'raw' }) })
    expect(await renderToString(app)).toContain('<div class="block-html"><script>alert(1)</script>')
  })
})

describe("a theme's own view (M1.4)", () => {
  it('draws the block types it names with the theme component, and the rest with the core views', async () => {
    const Quote = defineComponent({
      props: { block: { type: Object as PropType<Block>, required: true }, context: { type: Object, required: true } },
      setup: (props) => () => h('aside', { class: 'theme-quote' }, props.block.children.length),
    })
    const quote = createBlock('core/quote', {}, [createBlock('core/paragraph', { content: text('Sitat') })])
    const app = createSSRApp({
      render: () =>
        h(BlockDocument, {
          blocks: [quote, createBlock('core/paragraph', { content: text('Vanlig') })],
          views: new Map([['core/quote', Quote]]),
        }),
    })
    const html = await renderToString(app)
    expect(html).toContain('<aside class="theme-quote">1</aside>')
    expect(html).toContain('<p>Vanlig</p>')
    expect(html).not.toContain('block-quote')
  })
})

describe('preformatted text', () => {
  it('keeps a first line that is empty (the parser drops one newline after <pre>)', async () => {
    const html = await render([createBlock('core/preformatted', { content: text('\nto') })])
    expect(html).toContain('<pre class="block-preformatted">\n\nto</pre>')
  })
})

describe('what the data cannot do', () => {
  it('prints markup in a caption, a code block and a button as text', async () => {
    const html = await render([
      createBlock('core/image', { mediaId: MEDIA_ID, alt: 'x', caption: '<img src=x onerror=alert(1)>' }),
      createBlock('core/buttons', {}, [createBlock('core/button', { text: text('<b>Hei</b>'), url: '/x' })]),
    ])
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('&lt;b&gt;Hei&lt;/b&gt;')
  })

  it('draws a decorative image with an empty alt, and never a style attribute', async () => {
    const html = await render([
      createBlock('core/image', { mediaId: MEDIA_ID, alt: '', decorative: true }),
      ...CASES.map(([, b]) => b),
    ])
    // Vue writes an empty attribute without a value: `alt` is the same as `alt=""` in HTML.
    expect(html).toMatch(/<img [^>]*\salt[\s>]/)
    expect(html.replace(/<div class="block-html">.*?<\/div>/s, '')).not.toMatch(/\sstyle=/)
  })
})
