// WordPress' block markup for the default content, built from strings.ts the way wp_install_defaults() and
// WP_Privacy_Policy_Content::get_default_content( false, true ) concatenate it (WordPress 7.1.3), byte for byte.
import type { DefaultContentStrings } from './strings.ts'

/** sprintf() with one `%s`: the template must hold exactly one. */
export function fillOne(template: string, value: string): string {
  const parts = template.split('%s')
  if (parts.length !== 2) {
    throw new Error(`expected exactly one %s in a default-content string, found ${String(parts.length - 1)}`)
  }
  return `${parts[0] ?? ''}${value}${parts[1] ?? ''}`
}

const paragraph = (html: string): string => `<!-- wp:paragraph -->\n<p>${html}</p>\n<!-- /wp:paragraph -->`
const quote = (html: string): string =>
  `<!-- wp:quote -->\n<blockquote class="wp-block-quote">\n${paragraph(html)}\n</blockquote>\n<!-- /wp:quote -->`

/** The first post («Hello world!»): one paragraph, no trailing newline. */
export function firstPostMarkup(strings: DefaultContentStrings): string {
  return paragraph(strings.postText)
}

/** The first comment's text: plain text with line breaks and one link to Gravatar. */
export function firstCommentText(strings: DefaultContentStrings): string {
  return fillOne(strings.commentText, strings.gravatarUrl)
}

/** The sample page: two paragraphs and two quotes, blank lines between the blocks; `adminUrl` fills the last link. */
export function samplePageMarkup(strings: DefaultContentStrings, adminUrl: string): string {
  const [intro, first, between, second, outro] = strings.samplePageParagraphs
  return [paragraph(intro), quote(first), paragraph(between), quote(second), paragraph(fillOne(outro, adminUrl))].join(
    '\n\n',
  )
}

/**
 * The suggested privacy policy: per section a heading block and paragraph blocks, the first paragraph starting with
 * «Suggested text: », every block followed by one newline and none between them. `siteUrl` fills the address.
 */
export function privacyPolicyMarkup(strings: DefaultContentStrings, siteUrl: string): string {
  const suggested = `<strong class="privacy-policy-tutorial">${strings.suggestedText} </strong>`
  let out = ''
  strings.privacyPolicySections.forEach((section, s) => {
    out += `<!-- wp:heading -->\n<h2 class="wp-block-heading">${section.heading}</h2>\n<!-- /wp:heading -->\n`
    section.paragraphs.forEach((text, p) => {
      const filled = s === 0 && p === 0 ? fillOne(text, siteUrl) : text
      out += `<!-- wp:paragraph -->\n<p>${p === 0 ? suggested : ''}${filled}</p>\n<!-- /wp:paragraph -->\n`
    })
  })
  return out
}
