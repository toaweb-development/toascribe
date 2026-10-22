import { describe, expect, it } from 'vitest'

import {
  EMAIL_TEMPLATE,
  EmailJobPayload,
  EmailMessage,
  MAIL_MESSAGES,
  ONE_TIME_LINK_HOURS,
  SECURITY_NOTICE_ACTION,
  emailTokenAad,
  formatMessage,
  mailLink,
  oneLine,
  pickMailLocale,
  renderMail,
} from '../src/index.ts'
import type { EmailTemplate, MailContext } from '../src/index.ts'

const TOKEN = 'rJ3x9Qm2LkP7vN4sT8uYb1CdEfGhIjKlMnOpQrStUvW'
const SEALED = 'v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const CONTEXT: MailContext = { siteName: 'Bloggen min', origin: 'https://example.no', locale: 'nb' }

const SAMPLES: Record<EmailTemplate, unknown> = {
  password_reset: { template: 'password_reset', to: 'kari@example.no', data: { username: 'kari', token: TOKEN } },
  set_password: { template: 'set_password', to: 'kari@example.no', data: { username: 'kari', token: TOKEN } },
  email_change: { template: 'email_change', to: 'ny@example.no', data: { username: 'kari', token: TOKEN } },
  admin_new_user: {
    template: 'admin_new_user',
    to: 'admin@example.no',
    data: { username: 'ola', email: 'ola@example.no' },
  },
  admin_password_change: { template: 'admin_password_change', to: 'admin@example.no', data: { username: 'ola' } },
  account_exists: { template: 'account_exists', to: 'kari@example.no', data: { username: 'kari' } },
  email_change_notice: {
    template: 'email_change_notice',
    to: 'kari@example.no',
    data: { username: 'kari', newEmail: 'ny@example.no' },
  },
  security_notice: {
    template: 'security_notice',
    to: 'kari@example.no',
    data: { username: 'kari', action: 'mfa_added' },
  },
  test: { template: 'test', to: 'admin@example.no', data: { requestedBy: 'admin' } },
}

describe('EmailMessage', () => {
  it.each(EMAIL_TEMPLATE)('accepts the %s sample', (template) => {
    expect(EmailMessage.safeParse(SAMPLES[template]).success).toBe(true)
  })

  it('has a sample for every template', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...EMAIL_TEMPLATE].sort())
  })

  it.each([
    ['an unknown template', { template: 'newsletter', to: 'a@example.no', data: {} }],
    ['no recipient', { template: 'test', data: { requestedBy: 'admin' } }],
    ['a recipient that is not an address', { template: 'test', to: 'not-an-address', data: { requestedBy: 'admin' } }],
    [
      'a recipient with a header injection',
      { template: 'test', to: 'a@example.no\r\nBcc: x@example.no', data: { requestedBy: 'a' } },
    ],
    [
      'a field the template does not have',
      { template: 'test', to: 'a@example.no', data: { requestedBy: 'a', extra: 'x' } },
    ],
    ['a field outside data', { template: 'test', to: 'a@example.no', data: { requestedBy: 'a' }, cc: 'b@example.no' }],
    ['a token that is too short', { ...(SAMPLES.password_reset as object), data: { username: 'kari', token: 'abc' } }],
    [
      'a token with characters outside base64url',
      { ...(SAMPLES.password_reset as object), data: { username: 'kari', token: `${TOKEN.slice(0, 40)}!!` } },
    ],
    [
      'no token where the template needs one',
      { template: 'password_reset', to: 'a@example.no', data: { username: 'kari' } },
    ],
    [
      'a token where the template has none',
      { template: 'test', to: 'a@example.no', data: { requestedBy: 'a', token: TOKEN } },
    ],
    ['a name with a line break', { template: 'test', to: 'a@example.no', data: { requestedBy: 'a\nb' } }],
    ['an empty name', { template: 'test', to: 'a@example.no', data: { requestedBy: '' } }],
    ['a name that is too long', { template: 'test', to: 'a@example.no', data: { requestedBy: 'a'.repeat(201) } }],
    ['a body that is not an object', 'password_reset'],
  ])('refuses %s', (_name, input) => {
    expect(EmailMessage.safeParse(input).success).toBe(false)
  })
})

describe('EmailJobPayload (what is stored in the job)', () => {
  it('takes an encrypted token, and refuses a plain one', () => {
    const sealed = { template: 'password_reset', to: 'kari@example.no', data: { username: 'kari', token: SEALED } }
    expect(EmailJobPayload.safeParse(sealed).success).toBe(true)
    expect(EmailJobPayload.safeParse(SAMPLES.password_reset).success).toBe(false)
  })

  it('has no token for a template without one', () => {
    expect(EmailJobPayload.safeParse(SAMPLES.test).success).toBe(true)
  })
})

describe('emailTokenAad', () => {
  it('binds a sealed token to the template and the recipient', () => {
    expect(emailTokenAad('password_reset', 'Kari@Example.no')).toBe(emailTokenAad('password_reset', 'kari@example.no'))
    expect(emailTokenAad('password_reset', 'kari@example.no')).not.toBe(
      emailTokenAad('set_password', 'kari@example.no'),
    )
    expect(emailTokenAad('password_reset', 'kari@example.no')).not.toBe(
      emailTokenAad('password_reset', 'ola@example.no'),
    )
  })
})

describe('mailLink', () => {
  it('builds the link from the origin and the token, with the token in the fragment', () => {
    expect(mailLink('https://example.no', 'password_reset', TOKEN)).toBe(
      `https://example.no/admin/login?action=resetpass#token=${TOKEN}`,
    )
    expect(mailLink('https://example.no/', 'set_password', TOKEN)).toBe(
      `https://example.no/admin/login?action=setpassword#token=${TOKEN}`,
    )
    expect(mailLink('http://localhost:3000', 'email_change', TOKEN)).toBe(
      `http://localhost:3000/admin/login?action=confirmemail#token=${TOKEN}`,
    )
  })

  it('has no link for a template without one', () => {
    expect(mailLink('https://example.no', 'test', TOKEN)).toBeUndefined()
    expect(mailLink('https://example.no', 'admin_new_user', TOKEN)).toBeUndefined()
  })
})

describe('renderMail (bokmål)', () => {
  const render = (template: EmailTemplate, context: MailContext = CONTEXT) =>
    renderMail(EmailMessage.parse(SAMPLES[template]), context)

  it('renders the lost-password mail with the link, the site name and the lifetime', () => {
    const mail = render('password_reset')
    expect(mail.subject).toBe('[Bloggen min] Tilbakestill passordet')
    expect(mail.text).toContain('Hei kari,')
    expect(mail.text).toContain('Noen har bedt om å tilbakestille passordet for kontoen din på Bloggen min.')
    expect(mail.text).toContain(`Lenken gjelder i ${String(ONE_TIME_LINK_HOURS)} timer`)
    expect(mail.text).toContain(`https://example.no/admin/login?action=resetpass#token=${TOKEN}`)
    expect(mail.html).toContain(
      `<a href="https://example.no/admin/login?action=resetpass#token=${TOKEN}">Velg nytt passord</a>`,
    )
    expect(mail.html).toContain('lang="nb"')
    expect(mail.html).toContain('<meta charset="utf-8">')
  })

  it.each([
    ['set_password', '[Bloggen min] Velkommen! Velg passord', 'Velkommen til Bloggen min!'],
    ['email_change', '[Bloggen min] Bekreft den nye e-postadressen', 'Du har bedt om å bruke denne e-postadressen'],
    ['admin_new_user', '[Bloggen min] Ny bruker: ola', 'E-post: ola@example.no'],
    ['admin_password_change', '[Bloggen min] Passordet til ola er endret', 'er endret.'],
    ['account_exists', '[Bloggen min] Du har allerede en konto', 'brukernavnet kari'],
    ['email_change_notice', '[Bloggen min] E-postadressen på kontoen din skal byttes', 'til ny@example.no.'],
    ['security_notice', '[Bloggen min] Sikkerhetsendring på kontoen din', 'en ny autentiseringsapp'],
    ['test', '[Bloggen min] Test av e-post', 'sendt etter ønske fra admin'],
  ] as const)('renders %s', (template, subject, line) => {
    const mail = render(template)
    expect(mail.subject).toBe(subject)
    expect(mail.text).toContain(line)
    expect(mail.text.endsWith('\n')).toBe(true)
    expect(mail.text).toContain('Denne e-posten er sendt fra Bloggen min (https://example.no).')
  })

  it.each(SECURITY_NOTICE_ACTION)(
    'renders the security notice for %s with a sentence and not the action key',
    (action) => {
      const mail = renderMail(
        EmailMessage.parse({ template: 'security_notice', to: 'kari@example.no', data: { username: 'kari', action } }),
        CONTEXT,
      )
      expect(mail.text).toContain(MAIL_MESSAGES['nb']?.common.securityActions[action])
      expect(mail.text).not.toContain(action)
      expect(mail.html).not.toContain(action)
      expect(mail.text).toContain('bør du bytte passord med en gang')
    },
  )

  it('refuses a security notice with an action it does not know', () => {
    expect(
      EmailMessage.safeParse({
        template: 'security_notice',
        to: 'kari@example.no',
        data: { username: 'kari', action: 'something_else' },
      }).success,
    ).toBe(false)
  })

  it('puts a link in exactly the templates that have one', () => {
    for (const template of EMAIL_TEMPLATE) {
      const mail = render(template)
      const hasLink = ['password_reset', 'set_password', 'email_change'].includes(template)
      expect(mail.text.includes('#token='), template).toBe(hasLink)
      expect(mail.html.includes('<a href='), template).toBe(hasLink)
    }
  })

  it('never writes a token in a template without a link, and never in the subject', () => {
    for (const template of EMAIL_TEMPLATE) {
      expect(render(template).subject).not.toContain(TOKEN)
    }
  })

  it('escapes HTML in names and the site name', () => {
    const mail = renderMail(
      EmailMessage.parse({
        template: 'admin_new_user',
        to: 'admin@example.no',
        data: { username: '<script>alert(1)</script>', email: 'a@example.no' },
      }),
      { ...CONTEXT, siteName: 'A & "B" <i>' },
    )
    expect(mail.html).not.toContain('<script>')
    expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(mail.html).toContain('A &amp; &quot;B&quot; &lt;i&gt;')
    // The text part is plain text: nothing is escaped there.
    expect(mail.text).toContain('<script>alert(1)</script>')
  })

  it('keeps the subject on one line, whatever the site name holds', () => {
    const mail = render('test', { ...CONTEXT, siteName: 'Line one\r\nBcc: attacker@example.no' })
    expect(mail.subject).not.toMatch(/[\r\n]/)
    expect(mail.subject).toBe('[Line one Bcc: attacker@example.no] Test av e-post')
  })

  it('does not scan a value for placeholders', () => {
    const mail = renderMail(
      EmailMessage.parse({ template: 'admin_password_change', to: 'a@example.no', data: { username: '{siteName}' } }),
      CONTEXT,
    )
    expect(mail.subject).toBe('[Bloggen min] Passordet til {siteName} er endret')
  })

  it('uses æ, ø and å as they are', () => {
    const mail = renderMail(
      EmailMessage.parse({ template: 'password_reset', to: 'a@example.no', data: { username: 'Åse', token: TOKEN } }),
      { ...CONTEXT, siteName: 'Blåbærsyltetøy' },
    )
    expect(mail.subject).toBe('[Blåbærsyltetøy] Tilbakestill passordet')
    expect(mail.text).toContain('Hei Åse,')
  })

  it('falls back to the default language for one it does not have', () => {
    expect(render('test', { ...CONTEXT, locale: 'xx' }).subject).toBe('[Bloggen min] Test av e-post')
  })

  it('every catalogue string uses only placeholders its template supplies (the sample renders without an error)', () => {
    for (const template of EMAIL_TEMPLATE) {
      expect(() => render(template), template).not.toThrow()
    }
  })
})

describe('overrides (the seam for a theme)', () => {
  const message = EmailMessage.parse(SAMPLES.password_reset)

  it('merges strings over the built-in ones', () => {
    const mail = renderMail(message, CONTEXT, {
      messages: { nb: { templates: { password_reset: { subject: 'Nytt passord på {siteName}' } } } },
    })
    expect(mail.subject).toBe('Nytt passord på Bloggen min')
    expect(mail.text).toContain('Hei kari,') // the rest is the built-in text
  })

  it('serves a language the system does not ship, on top of the default one', () => {
    const mail = renderMail(
      message,
      { ...CONTEXT, locale: 'nn' },
      {
        messages: { nn: { templates: { password_reset: { subject: 'Nytt passord på {siteName}' } } } },
      },
    )
    expect(mail.subject).toBe('Nytt passord på Bloggen min')
    expect(mail.html).toContain('lang="nn"')
  })

  it('lets a renderer replace a whole template, and hands it the link', () => {
    let seen: string | undefined
    const mail = renderMail(message, CONTEXT, {
      render: {
        password_reset: (input) => {
          seen = input.link
          return { subject: 's', text: 't', html: 'h' }
        },
      },
    })
    expect(mail).toEqual({ subject: 's', text: 't', html: 'h' })
    expect(seen).toBe(`https://example.no/admin/login?action=resetpass#token=${TOKEN}`)
  })

  it('leaves the other templates alone', () => {
    const mail = renderMail(EmailMessage.parse(SAMPLES.test), CONTEXT, {
      render: { password_reset: () => ({ subject: 's', text: 't', html: 'h' }) },
    })
    expect(mail.subject).toBe('[Bloggen min] Test av e-post')
  })
})

describe('formatMessage and oneLine', () => {
  it('throws for a placeholder with no value, naming it', () => {
    expect(() => formatMessage('Hei {navn}', {})).toThrow('{navn}')
  })

  it('replaces every occurrence', () => {
    expect(formatMessage('{a} og {a}', { a: 'x' })).toBe('x og x')
  })

  it('turns control characters into spaces', () => {
    expect(oneLine('a\r\nb\tc\u0000d')).toBe('a b c d')
  })
})

describe('pickMailLocale', () => {
  it.each([
    ['nb', 'nb'],
    ['nb-NO', 'nb'],
    ['nb_NO', 'nb'],
    ['xx', 'nb'],
    ['', 'nb'],
  ])('%j gives %s', (input, expected) => {
    expect(pickMailLocale(input)).toBe(expected)
  })

  it('knows the shipped catalogues', () => {
    expect(Object.keys(MAIL_MESSAGES)).toContain('nb')
  })
})
