import type { EmailTemplate, SecurityNoticeAction } from './mail.ts'
import { MAIL_MESSAGES_NB } from './mail-messages.nb.ts'

// The words of the mail, one catalogue per language, with keys in English and values in the language (PLAN: templates can
// be overridden by a theme and translated). A string may hold `{name}` placeholders; the ones a template can use are
// `siteName`, `siteUrl`, `hours` (how long a link works) and the fields of its data (`username`, `email`, `requestedBy`; for
// a `security_notice`, `action` is the sentence from `common.securityActions`).
// A placeholder that has no value is an error, so a typo in a catalogue fails a test and not a customer's mail.

/** The words of one template. */
export interface TemplateStrings {
  /** The subject line (one line; control characters are removed). */
  readonly subject: string
  readonly greeting: string
  /** Paragraphs before the link. */
  readonly intro: readonly string[]
  /** The text of the link; only for a template that has a link. */
  readonly action?: string
  /** Paragraphs after the link. */
  readonly outro: readonly string[]
}

export interface MailMessages {
  readonly common: {
    /** Under every mail. */
    readonly footer: string
    /** Before the plain address of the link, for a mail program that does not show links. */
    readonly linkFallback: string
    /** What happened, one sentence for each action of a `security_notice`; the mail's `{action}` placeholder. */
    readonly securityActions: Readonly<Record<SecurityNoticeAction, string>>
  }
  readonly templates: Readonly<Record<EmailTemplate, TemplateStrings>>
}

/** The catalogues the system ships with. A language that is not here uses `DEFAULT_MAIL_LOCALE`. */
export const MAIL_MESSAGES: Readonly<Record<string, MailMessages>> = { nb: MAIL_MESSAGES_NB }

export const DEFAULT_MAIL_LOCALE = 'nb'

/** `nb`, `nb-NO` and `nb_NO` all pick the `nb` catalogue; an unknown language picks the default. */
export function pickMailLocale(locale: string, available: Iterable<string> = Object.keys(MAIL_MESSAGES)): string {
  const known = new Set(available)
  const exact = locale.replace('_', '-')
  if (known.has(exact)) {
    return exact
  }
  const language = exact.split('-')[0] ?? ''
  return known.has(language) ? language : DEFAULT_MAIL_LOCALE
}
