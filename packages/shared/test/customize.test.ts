import { describe, expect, it } from 'vitest'

import {
  CustomizePreviewMessage,
  customCssProblem,
  customizationCss,
  SiteCustomization,
  themeCustomization,
} from '../src/index.ts'

describe('«Ekstra CSS» cannot leave its <style>', () => {
  it.each([
    '</style><script>alert(1)</script>',
    '</STYLE >',
    'a::after { content: "<" }',
    'a::after { content: "\\3c /style>" }',
    'a::after { content: "\\00003C" }',
    '<!--',
  ])('refuses %s', (css) => {
    expect(customCssProblem(css)).toBeDefined()
  })

  it('takes ordinary CSS, a child selector included', () => {
    expect(customCssProblem('nav > ul { gap: 1rem } a:hover { color: #123456 }')).toBeUndefined()
  })

  it('refuses more than the limit', () => {
    expect(customCssProblem('a{}'.repeat(40_000))).toBeDefined()
  })
})

describe('themeCustomization', () => {
  const spec = {
    colors: { primary: { name: 'Primær', default: '#000000' } },
    fonts: {
      body: { name: 'Brødtekst', default: 'system-ui', choices: [{ label: 'Serif', value: 'Georgia, serif' }] },
    },
  }

  it('keeps only the colours the theme names, and a font only among its choices', () => {
    const kept = themeCustomization(
      {
        colors: { primary: '#ff0000', gone: '#00ff00' },
        fonts: { body: 'Comic Sans MS', heading: 'Georgia, serif' },
        customCss: 'a{}',
      },
      spec,
    )
    expect(kept).toEqual({ colors: { primary: '#ff0000' }, fonts: {}, customCss: 'a{}' })
    expect(themeCustomization({ colors: {}, fonts: { body: 'Georgia, serif' }, customCss: '' }, spec).fonts).toEqual({
      body: 'Georgia, serif',
    })
  })

  it('does not take a slot from the prototype', () => {
    expect(themeCustomization({ colors: { constructor: '#ffffff' }, fonts: {}, customCss: '' }, spec).colors).toEqual(
      {},
    )
  })

  it('writes the choices as variables, then the CSS', () => {
    expect(
      customizationCss({ colors: { primary: '#ff0000' }, fonts: { body: 'Georgia, serif' }, customCss: 'a{}' }),
    ).toBe(':root { --theme-color-primary: #ff0000; --theme-font-body: Georgia, serif; }\na{}')
  })
})

describe('what the site draws', () => {
  it('never holds a <', () => {
    expect(SiteCustomization.safeParse({ css: '</style>', logo: null, icon: null }).success).toBe(false)
  })

  const message = {
    type: 'toascribe:customize',
    title: 'Nettsted',
    tagline: '',
    customization: { colors: {}, fonts: {}, customCss: '' },
    logo: null,
    icon: null,
  }

  it('takes a preview message with the choices', () => {
    expect(CustomizePreviewMessage.safeParse(message).success).toBe(true)
  })

  it.each([
    ['CSS that ends the style', { ...message, customization: { ...message.customization, customCss: '</style>' } }],
    ['a colour that is not one', { ...message, customization: { ...message.customization, colors: { a: 'red;}' } } }],
    [
      'a font that leaves its declaration',
      { ...message, customization: { ...message.customization, fonts: { a: 'x;}' } } },
    ],
    [
      'a logo from another scheme',
      { ...message, logo: { id: crypto.randomUUID(), url: 'javascript:alert(1)', width: 1, height: 1, alt: '' } },
    ],
    [
      'a logo from another host by //',
      { ...message, logo: { id: crypto.randomUUID(), url: '//evil.example/x.png', width: 1, height: 1, alt: '' } },
    ],
    ['another field', { ...message, extra: true }],
  ])('refuses %s', (_name, input) => {
    expect(CustomizePreviewMessage.safeParse(input).success).toBe(false)
  })
})
