import type { EmailMessage, EmailTemplate } from './mail.ts'
import { ONE_TIME_LINK_HOURS } from './mail.ts'
import { DEFAULT_MAIL_LOCALE, MAIL_MESSAGES, pickMailLocale } from './mail-messages.ts'
import type { MailMessages, TemplateStrings } from './mail-messages.ts'

// Turns a message into a subject, a plain-text body and a simple HTML body. Pure strings: no Node or browser API, so the
// worker renders it and a theme can render it for a preview. The words come from the catalogue of the site's language
// (mail-messages.ts); the link comes from PUBLIC_ORIGIN and the token; the site name from the `blogname` setting.

/** What the renderer knows about the site. */
export interface MailContext {
  /** `blogname`; the caller falls back to the host name when it is empty. */
  readonly siteName: string
  /** PUBLIC_ORIGIN, e.g. `https://example.com`. Links are built on it and on nothing a request said. */
  readonly origin: string
  /** The `locale` setting (`nb`). */
  readonly locale: string
}

export interface RenderedMail {
  /** One line. */
  readonly subject: string
  readonly text: string
  readonly html: string
}

/** What a template renderer in an override gets. */
export interface RenderInput {
  readonly message: EmailMessage
  readonly context: MailContext
  /** The catalogue strings of the template, overrides applied. */
  readonly strings: TemplateStrings
  readonly common: MailMessages['common']
  /** The link of the mail, for the templates that have one. */
  readonly link: string | undefined
}

/**
 * The seam for a theme (PLAN: templates can be overridden by a theme and translated): strings merged over the built-in ones,
 * and, where the strings are not enough, a renderer that replaces the layout of a whole template. Nothing passes one yet.
 */
export interface MailOverrides {
  readonly messages?: Readonly<
    Record<
      string,
      {
        readonly common?: Partial<MailMessages['common']>
        readonly templates?: Partial<Record<EmailTemplate, Partial<TemplateStrings>>>
      }
    >
  >
  readonly render?: Partial<Record<EmailTemplate, (input: RenderInput) => RenderedMail>>
}

/** Where a link opens, per template. `#token=` is a fragment: it is never sent to a server, a log or a Referer header. */
const LINK_ACTIONS: Readonly<Partial<Record<EmailTemplate, string>>> = {
  password_reset: 'resetpass',
  set_password: 'setpassword',
  email_change: 'confirmemail',
  admin_email_change: 'confirmadminemail',
}

/** The one-time link of a message, or undefined for a template without one. Built from the origin and the token only. */
export function mailLink(origin: string, template: EmailTemplate, token: string): string | undefined {
  const action = LINK_ACTIONS[template]
  if (action === undefined) {
    return undefined
  }
  const base = origin.replace(/\/+$/, '')
  return `${base}/admin/login?action=${action}#token=${encodeURIComponent(token)}`
}

const CONTROL = /\p{Cc}/gu

/** One line of text: every control character (CR and LF included) becomes a space. */
export function oneLine(text: string): string {
  return text.replace(CONTROL, ' ').replace(/ {2,}/g, ' ').trim()
}

/** Replaces `{name}` with the value. A name with no value throws. Values are not scanned again, so a `{x}` inside one stays. */
export function formatMessage(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{([A-Za-z]+)\}/g, (_match, name: string) => {
    const value = values[name]
    if (value === undefined) {
      throw new Error(`The mail text uses {${name}}, which this template does not have`)
    }
    return value
  })
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function mergeStrings(base: TemplateStrings, over: Partial<TemplateStrings> | undefined): TemplateStrings {
  return over === undefined ? base : { ...base, ...over }
}

/** The values a placeholder can take: the site, the lifetime of a link, and the data of the message except the token and the requester's account id (a notice's action as its sentence). */
function valuesFor(
  message: EmailMessage,
  context: MailContext,
  common: MailMessages['common'],
): Record<string, string> {
  const values: Record<string, string> = {
    siteName: oneLine(context.siteName),
    siteUrl: context.origin.replace(/\/+$/, ''),
    hours: String(ONE_TIME_LINK_HOURS),
  }
  for (const [key, value] of Object.entries(message.data)) {
    if (key === 'action' && message.template === 'security_notice') {
      values[key] = common.securityActions[message.data.action]
    } else if (key !== 'token' && key !== 'requestedById' && value !== undefined) {
      // `requestedById` is for the worker's audit entry, not for the text.
      values[key] = value
    }
  }
  return values
}

/** The default layout. */
function renderDefault(input: RenderInput, values: Readonly<Record<string, string>>): RenderedMail {
  const { strings, common, link, context } = input
  const say = (text: string) => formatMessage(text, values)

  const greeting = say(strings.greeting)
  const intro = strings.intro.map(say)
  const outro = strings.outro.map(say)
  const action = strings.action === undefined ? undefined : say(strings.action)
  const fallback = say(common.linkFallback)
  const footer = say(common.footer)

  const textBlocks = [greeting, ...intro]
  if (link !== undefined && action !== undefined) {
    textBlocks.push(`${action}:\n${link}`)
  }
  textBlocks.push(...outro, `-- \n${footer}`)

  const htmlBlocks = [`<p>${escapeHtml(greeting)}</p>`, ...intro.map((p) => `<p>${escapeHtml(p)}</p>`)]
  if (link !== undefined && action !== undefined) {
    const href = escapeHtml(link)
    htmlBlocks.push(
      `<p><a href="${href}">${escapeHtml(action)}</a></p>`,
      `<p>${escapeHtml(fallback)}<br><a href="${href}">${href}</a></p>`,
    )
  }
  htmlBlocks.push(...outro.map((p) => `<p>${escapeHtml(p)}</p>`), `<hr><p><small>${escapeHtml(footer)}</small></p>`)

  const subject = oneLine(say(strings.subject))
  const html = [
    '<!doctype html>',
    `<html lang="${escapeHtml(context.locale)}">`,
    `<head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>`,
    `<body>${htmlBlocks.join('\n')}</body>`,
    '</html>',
  ].join('\n')

  return { subject, text: `${textBlocks.join('\n\n')}\n`, html }
}

/** Renders a message in the site's language. Throws when a catalogue string uses a placeholder the template does not have. */
export function renderMail(message: EmailMessage, context: MailContext, overrides: MailOverrides = {}): RenderedMail {
  const locale = pickMailLocale(context.locale, [
    ...Object.keys(MAIL_MESSAGES),
    ...Object.keys(overrides.messages ?? {}),
  ])
  const builtIn = MAIL_MESSAGES[locale] ?? MAIL_MESSAGES[DEFAULT_MAIL_LOCALE]
  if (builtIn === undefined) {
    throw new Error('The default mail catalogue is missing')
  }
  const over = overrides.messages?.[locale]
  const strings = mergeStrings(builtIn.templates[message.template], over?.templates?.[message.template])
  const common = { ...builtIn.common, ...over?.common }
  const link = 'token' in message.data ? mailLink(context.origin, message.template, message.data.token) : undefined

  const input: RenderInput = { message, context: { ...context, locale }, strings, common, link }
  const custom = overrides.render?.[message.template]
  return custom === undefined ? renderDefault(input, valuesFor(message, context, common)) : custom(input)
}
