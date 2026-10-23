// WordPress' default content as toascribe builds it: the markup against WordPress' own output (fixtures/), the two
// typo decisions, the English fallback, and the block parser. No database: the rows are in install.test.ts.
import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { blocksText, htmlToText, parseBlockMarkup } from '../src/default-content/blocks.ts'
import type { ParsedBlock } from '../src/default-content/blocks.ts'
import {
  fillOne,
  firstCommentText,
  firstPostMarkup,
  privacyPolicyMarkup,
  samplePageMarkup,
} from '../src/default-content/markup.ts'
import { DEFAULT_CONTENT_STRINGS, defaultContentStrings } from '../src/default-content/strings.ts'

const fixture = (name: string): Promise<string> => readFile(new URL(`fixtures/${name}`, import.meta.url), 'utf8')

const nb = DEFAULT_CONTENT_STRINGS.nb
const en = DEFAULT_CONTENT_STRINGS.en
const SITE = 'https://blogg.example.test'

/** WordPress' serialize_blocks() for a tree from parseBlockMarkup(): the inverse, to prove nothing is lost. */
function serialize(block: ParsedBlock): string {
  const name = block.blockName.startsWith('core/') ? block.blockName.slice(5) : block.blockName
  const attrs = Object.keys(block.attrs).length > 0 ? `${JSON.stringify(block.attrs)} ` : ''
  let inner = 0
  const body = block.innerContent
    .map((chunk) => {
      if (chunk !== null) {
        return chunk
      }
      const child = block.innerBlocks[inner]
      inner += 1
      return child === undefined ? '' : serialize(child)
    })
    .join('')
  return `<!-- wp:${name} ${attrs}-->${body}<!-- /wp:${name} -->`
}

describe('default content markup (WordPress 7.1.3, nb_NO)', () => {
  it('builds the first post exactly as WordPress stores it', async () => {
    expect(firstPostMarkup(nb)).toBe(await fixture('wp-first-post-nb.txt'))
  })

  it('builds the first comment with the nb Gravatar link and two line breaks', async () => {
    expect(firstCommentText(nb)).toBe(await fixture('wp-first-comment-nb.txt'))
    expect(firstCommentText(nb).split('\n')).toHaveLength(3)
  })

  it('builds the sample page exactly, with the admin URL in the dashboard link', async () => {
    const admin = `${SITE}/admin/`
    expect(samplePageMarkup(nb, admin)).toBe((await fixture('wp-sample-page-nb.txt')).replace('ADMINURL', admin))
    // The upstream typos are kept (Tor: the same text as the Norwegian translation).
    expect(samplePageMarkup(nb, admin)).toContain('forskjellig fra ert innlegg')
    expect(samplePageMarkup(nb, admin)).toContain('har vært levert kvalitetsduppeditter')
    expect(samplePageMarkup(nb, admin)).toContain('Pi&#241;a colada')
  })

  it('builds the privacy policy exactly, except the two broken entities, which become « and »', async () => {
    const upstream = (await fixture('wp-privacy-policy-nb.txt')).replace('{SITEURL}', SITE)
    expect(upstream).toContain('&lauot;Husk meg&raquot;')
    const built = privacyPolicyMarkup(nb, SITE)
    expect(built).toBe(upstream.replace('&lauot;', '«').replace('&raquot;', '»'))
    expect(built).toContain('«Husk meg»')
    expect(built).not.toMatch(/&lauot;|&raquot;/)
    // The missing full stop after the address is kept, as upstream.
    expect(built).toContain(`Vår nettstedsadresse er: ${SITE}</p>`)
  })

  it('stores the slugs WordPress stores, the privacy slug with its æ', () => {
    expect([nb.categorySlug, nb.postSlug, nb.samplePageSlug, nb.privacyPolicySlug]).toEqual([
      'ukategorisert',
      'hei-verden',
      'testside',
      'personvernerklæring',
    ])
    expect([nb.categoryName, nb.postTitle, nb.samplePageTitle, nb.privacyPolicyTitle]).toEqual([
      'Ukategorisert',
      'Hei, verden!',
      'Testside',
      'Personvernerklæring',
    ])
    expect([nb.commentAuthor, nb.commentAuthorUrl]).toEqual(['En WordPress-kommentator', 'https://nb.wordpress.org/'])
  })
})

describe('the English fallback', () => {
  it('has WordPress’ English strings and slugs', () => {
    expect([en.categorySlug, en.postSlug, en.samplePageSlug, en.privacyPolicySlug]).toEqual([
      'uncategorized',
      'hello-world',
      'sample-page',
      'privacy-policy',
    ])
    expect(firstPostMarkup(en)).toBe(
      '<!-- wp:paragraph -->\n<p>Welcome to WordPress. This is your first post. Edit or delete it, then start writing!</p>\n<!-- /wp:paragraph -->',
    )
    expect(firstCommentText(en)).toContain('<a href="https://gravatar.com/">Gravatar</a>.')
    expect(privacyPolicyMarkup(en, SITE)).toContain(
      `<p><strong class="privacy-policy-tutorial">Suggested text: </strong>Our website address is: ${SITE}.</p>`,
    )
    expect(privacyPolicyMarkup(en, SITE)).toContain('If you select &quot;Remember Me&quot;, your login')
  })

  it('has the same shape as bokmål: five page paragraphs, nine policy sections of the same lengths', () => {
    expect(en.samplePageParagraphs).toHaveLength(5)
    expect(en.privacyPolicySections.map((s) => s.paragraphs.length)).toEqual(
      nb.privacyPolicySections.map((s) => s.paragraphs.length),
    )
    expect(en.privacyPolicySections.map((s) => s.paragraphs.length)).toEqual([1, 2, 1, 4, 2, 1, 2, 1, 1])
  })

  it('picks bokmål for nb and nb-NO, and English for every other locale', () => {
    expect(defaultContentStrings('nb')).toBe(nb)
    expect(defaultContentStrings('nb-NO')).toBe(nb)
    for (const locale of ['en', 'en-GB', 'nn', 'de', 'sv']) {
      expect(defaultContentStrings(locale), locale).toBe(en)
    }
  })

  it('fills exactly one %s', () => {
    expect(fillOne('a %s b', 'x')).toBe('a x b')
    expect(() => fillOne('no placeholder', 'x')).toThrow(/exactly one/)
    expect(() => fillOne('%s and %s', 'x')).toThrow(/exactly one/)
  })
})

describe('parseBlockMarkup (WordPress parse_blocks shape)', () => {
  it('parses the privacy policy into 24 blocks, 9 of them headings, and serialises back to the same markup', () => {
    const markup = privacyPolicyMarkup(nb, SITE)
    const blocks = parseBlockMarkup(markup)
    expect(blocks).toHaveLength(24)
    expect(blocks.filter((b) => b.blockName === 'core/heading')).toHaveLength(9)
    expect(blocks.filter((b) => b.blockName === 'core/paragraph')).toHaveLength(15)
    expect(`${blocks.map(serialize).join('\n')}\n`).toBe(markup)
  })

  it('keeps a quote’s paragraph as an inner block, with null where it goes', () => {
    const blocks = parseBlockMarkup(samplePageMarkup(nb, `${SITE}/admin/`))
    expect(blocks.map((b) => b.blockName)).toEqual([
      'core/paragraph',
      'core/quote',
      'core/paragraph',
      'core/quote',
      'core/paragraph',
    ])
    const quote = blocks[1]
    expect(quote?.innerContent).toEqual(['\n<blockquote class="wp-block-quote">\n', null, '\n</blockquote>\n'])
    expect(quote?.innerHTML).toBe('\n<blockquote class="wp-block-quote">\n\n</blockquote>\n')
    expect(quote?.innerBlocks.map((b) => b.blockName)).toEqual(['core/paragraph'])
    expect(blocks.map(serialize).join('\n\n')).toBe(samplePageMarkup(nb, `${SITE}/admin/`))
  })

  it('gives a paragraph WordPress’ innerHTML and empty attrs', () => {
    expect(parseBlockMarkup(firstPostMarkup(nb))).toEqual([
      {
        blockName: 'core/paragraph',
        attrs: {},
        innerBlocks: [],
        innerHTML: `\n<p>${nb.postText}</p>\n`,
        innerContent: [`\n<p>${nb.postText}</p>\n`],
      },
    ])
  })

  it('reads attributes, namespaces and void blocks', () => {
    const blocks = parseBlockMarkup(
      '<!-- wp:heading {"level":3} -->\n<h3>x</h3>\n<!-- /wp:heading -->\n<!-- wp:acme/widget {"a":[1,2]} /-->',
    )
    expect(blocks.map((b) => [b.blockName, b.attrs, b.innerHTML])).toEqual([
      ['core/heading', { level: 3 }, '\n<h3>x</h3>\n'],
      ['acme/widget', { a: [1, 2] }, ''],
    ])
  })

  it('refuses text outside a block and unbalanced markup instead of storing half of it', () => {
    expect(() => parseBlockMarkup('<p>loose</p>')).toThrow(/outside a block/)
    expect(() => parseBlockMarkup('<!-- wp:paragraph --><p>x</p>')).toThrow(/open/)
    expect(() => parseBlockMarkup('<!-- wp:paragraph --><p>x</p><!-- /wp:quote -->')).toThrow(/closes core\/quote/)
    expect(() => parseBlockMarkup('<!-- wp:paragraph {"a":} --><p>x</p><!-- /wp:paragraph -->')).toThrow()
  })

  it('extracts the visible text for the search vector, entities decoded', () => {
    expect(htmlToText('<p>jeg liker Pi&#241;a colada &amp; &quot;x&quot; &#x2019;</p>')).toBe(
      'jeg liker Piña colada & "x" ’',
    )
    const text = blocksText(parseBlockMarkup(samplePageMarkup(nb, `${SITE}/admin/`)))
    expect(text).toContain('Piña colada')
    expect(text).toContain('ditt kontrollpanel')
    expect(text).not.toMatch(/[<>]/)
  })
})
