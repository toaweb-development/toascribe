import type { MailMessages } from './mail-messages.ts'

// Bokmål. Keys are English (see mail-messages.ts), values are what the reader sees.

const ADMIN_NOTE = 'Du får denne meldingen fordi du er administrator. Varslene kan slås av i innstillingene.'

export const MAIL_MESSAGES_NB: MailMessages = {
  common: {
    footer: 'Denne e-posten er sendt fra {siteName} ({siteUrl}).',
    linkFallback: 'Virker ikke lenken? Kopier denne adressen inn i nettleseren:',
  },
  templates: {
    password_reset: {
      subject: '[{siteName}] Tilbakestill passordet',
      greeting: 'Hei {username},',
      intro: [
        'Noen har bedt om å tilbakestille passordet for kontoen din på {siteName}.',
        'Bruk lenken under for å velge et nytt passord. Lenken gjelder i {hours} timer og kan bare brukes én gang.',
      ],
      action: 'Velg nytt passord',
      outro: ['Var det ikke du som ba om dette, kan du se bort fra denne e-posten. Passordet ditt er ikke endret.'],
    },
    set_password: {
      subject: '[{siteName}] Velkommen! Velg passord',
      greeting: 'Hei {username},',
      intro: [
        'Velkommen til {siteName}! Det er laget en konto til deg med brukernavnet {username}.',
        'Velg et passord for å ta kontoen i bruk. Lenken gjelder i {hours} timer og kan bare brukes én gang.',
      ],
      action: 'Velg passord',
      outro: ['Venter du ikke denne e-posten, kan du se bort fra den.'],
    },
    email_change: {
      subject: '[{siteName}] Bekreft den nye e-postadressen',
      greeting: 'Hei {username},',
      intro: [
        'Du har bedt om å bruke denne e-postadressen for kontoen din på {siteName}.',
        'Bekreft med lenken under. Lenken gjelder i {hours} timer og kan bare brukes én gang.',
      ],
      action: 'Bekreft e-postadressen',
      outro: ['Var det ikke du som ba om dette, kan du se bort fra denne e-posten. Kontoen er ikke endret.'],
    },
    admin_new_user: {
      subject: '[{siteName}] Ny bruker: {username}',
      greeting: 'Hei,',
      intro: ['En ny bruker er opprettet på {siteName}.', 'Brukernavn: {username}', 'E-post: {email}'],
      outro: [ADMIN_NOTE],
    },
    admin_password_change: {
      subject: '[{siteName}] Passordet til {username} er endret',
      greeting: 'Hei,',
      intro: ['Passordet til brukeren {username} på {siteName} er endret.'],
      outro: [ADMIN_NOTE],
    },
    test: {
      subject: '[{siteName}] Test av e-post',
      greeting: 'Hei,',
      intro: [
        'Dette er en testmelding fra {siteName}. Når du kan lese den, fungerer utsendingen av e-post.',
        'Meldingen er sendt etter ønske fra {requestedBy}.',
      ],
      outro: [],
    },
  },
}
