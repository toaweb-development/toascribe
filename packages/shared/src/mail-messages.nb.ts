import type { MailMessages } from './mail-messages.ts'

// Bokmål. Keys are English (see mail-messages.ts), values are what the reader sees.

const ADMIN_NOTE = 'Du får denne meldingen fordi du er administrator. Varslene kan slås av i innstillingene.'

export const MAIL_MESSAGES_NB: MailMessages = {
  common: {
    footer: 'Denne e-posten er sendt fra {siteName} ({siteUrl}).',
    linkFallback: 'Virker ikke lenken? Kopier denne adressen inn i nettleseren:',
    securityActions: {
      mfa_added: 'Det blir lagt til en ny autentiseringsapp (tofaktor) på kontoen din.',
      mfa_removed: 'En autentiseringsapp (tofaktor) blir fjernet fra kontoen din.',
      recovery_codes_regenerated: 'Det blir laget nye gjenopprettingskoder for kontoen din. De gamle slutter å virke.',
      password_changed: 'Passordet på kontoen din blir endret.',
      password_reset: 'Passordet på kontoen din er tilbakestilt med en lenke fra «Mistet passordet?».',
      mfa_reset:
        'Tofaktor og gjenopprettingskoder er fjernet fra kontoen din av en administrator, og du er logget ut overalt.',
      password_reset_by_admin: 'Passordet på kontoen din er byttet av en administrator, og du er logget ut overalt.',
      login_limit_reset:
        'Ventetiden etter mislykkede innloggingsforsøk på kontoen din er opphevet av en administrator. Passordet er ikke endret.',
    },
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
    account_exists: {
      subject: '[{siteName}] Du har allerede en konto',
      greeting: 'Hei,',
      intro: [
        'Noen har prøvd å bruke denne e-postadressen til en konto på {siteName}, men du har allerede en konto med brukernavnet {username}.',
        'Har du glemt passordet, kan du velge et nytt med «Mistet passordet?» på innloggingssiden.',
      ],
      outro: ['Var det ikke du som prøvde, kan du se bort fra denne e-posten. Ingenting er endret.'],
    },
    email_change_notice: {
      subject: '[{siteName}] E-postadressen på kontoen din skal byttes',
      greeting: 'Hei {username},',
      intro: [
        'Det er bedt om å bytte e-postadressen på kontoen din på {siteName} til {newEmail}.',
        'Byttet skjer først når den nye adressen er bekreftet med en lenke vi har sendt dit. Kontoen har ikke endret seg ennå.',
      ],
      outro: [
        'Var det ikke du som ba om dette, bør du bytte passord med en gang og logge ut overalt ellers. Da blir byttet stoppet.',
      ],
    },
    security_notice: {
      subject: '[{siteName}] Sikkerhetsendring på kontoen din',
      greeting: 'Hei {username},',
      intro: [
        '{action}',
        'Dette er en melding om endringen på kontoen din på {siteName}. Du trenger ikke gjøre noe hvis det var du.',
      ],
      outro: [
        'Var det ikke du, bør du bytte passord med en gang, logge ut overalt ellers og si fra til en administrator.',
      ],
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
