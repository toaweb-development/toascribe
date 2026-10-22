// The SMTP connection of the worker (K-284, K-286). Settings first, then the defaults from .env (app-config «Settings-først»):
// for every field, a value that is set in the `smtp_*` and `mail_from_*` settings is used, and null means «use the default from
// the environment». The password in the settings is encrypted with the site key (K-318); it is decrypted here and goes nowhere
// but into the connection. Nothing in this file logs a setting value.
import { SMTP_PASSWORD_AAD } from '@toascribe/shared'
import type { CoreSettings, KeyRing, SmtpSecureMode } from '@toascribe/shared'
import nodemailer from 'nodemailer'
import type { SMTPTransportOptions } from 'nodemailer'
import type { Logger } from 'pino'

/** The part of the worker's .env that stands behind the settings (config.ts). */
export interface MailEnvDefaults {
  readonly SMTP_HOST?: string | undefined
  readonly SMTP_PORT?: number | undefined
  readonly SMTP_SECURE?: SmtpSecureMode | undefined
  readonly SMTP_USERNAME?: string | undefined
  readonly SMTP_PASSWORD?: string | undefined
  readonly MAIL_FROM_ADDRESS?: string | undefined
  readonly MAIL_FROM_NAME?: string | undefined
}

export type MailSettings = Pick<
  CoreSettings,
  | 'blogname'
  | 'locale'
  | 'mail_from_address'
  | 'mail_from_name'
  | 'smtp_host'
  | 'smtp_port'
  | 'smtp_secure'
  | 'smtp_username'
  | 'smtp_password'
>

export interface ResolvedSmtp {
  readonly host: string
  readonly port: number
  readonly secure: SmtpSecureMode
  readonly auth: { readonly user: string; readonly pass: string } | undefined
  readonly from: { readonly address: string; readonly name: string }
}

/** The mail cannot be sent because of how the site is set up. The message names settings and variables, never values. */
export class MailConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MailConfigError'
  }
}

export const DEFAULT_PORT: Readonly<Record<SmtpSecureMode, number>> = { tls: 465, starttls: 587, none: 25 }

/**
 * The connection and the sender for one mail. `siteName` is the fallback for the sender's name (the setting says: null uses
 * `blogname`).
 */
export async function resolveSmtp(
  settings: MailSettings,
  env: MailEnvDefaults,
  keyRing: KeyRing,
  siteName: string,
): Promise<ResolvedSmtp> {
  const host = settings.smtp_host ?? env.SMTP_HOST
  if (host === undefined) {
    throw new MailConfigError('No SMTP host: set smtp_host in the settings or SMTP_HOST in the environment')
  }
  const address = settings.mail_from_address ?? env.MAIL_FROM_ADDRESS
  if (address === undefined) {
    throw new MailConfigError(
      'No sender address: set mail_from_address in the settings or MAIL_FROM_ADDRESS in the environment',
    )
  }
  const secure = settings.smtp_secure ?? env.SMTP_SECURE ?? 'starttls'
  const port = settings.smtp_port ?? env.SMTP_PORT ?? DEFAULT_PORT[secure]

  const user = settings.smtp_username ?? env.SMTP_USERNAME
  let auth: ResolvedSmtp['auth']
  if (user !== undefined) {
    let pass: string | undefined = env.SMTP_PASSWORD
    if (settings.smtp_password !== null) {
      try {
        pass = await keyRing.decrypt(settings.smtp_password, SMTP_PASSWORD_AAD)
      } catch {
        // DecryptionError says nothing about why, and neither does this: the key may have been replaced without re-encrypting.
        throw new MailConfigError('The smtp_password setting cannot be decrypted with the keys in the environment')
      }
    }
    if (pass === undefined) {
      throw new MailConfigError('An SMTP user name is set but no password: set smtp_password or SMTP_PASSWORD')
    }
    auth = { user, pass }
  }

  return {
    host,
    port,
    secure,
    auth,
    from: { address, name: settings.mail_from_name ?? env.MAIL_FROM_NAME ?? siteName },
  }
}

/** Seconds are what people think in; nodemailer wants milliseconds. All of them are set: its defaults are two minutes and ten. */
export const SMTP_TIMEOUTS_MS = { connection: 10_000, greeting: 10_000, socket: 30_000, dns: 5_000 } as const

/**
 * nodemailer's options for a connection. `starttls` demands the upgrade (`requireTLS`: no plain text fallback if the server
 * does not offer it), `tls` connects with TLS from the first byte, and `none` is the plain SMTP the administrator asked for.
 * Its own logging is a child of ours that only passes warnings and errors; `debug` stays off, because that is what would put
 * the SMTP conversation (the message, and the login) in the log.
 */
export function smtpTransportOptions(smtp: ResolvedSmtp, logger: Logger): SMTPTransportOptions {
  return {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure === 'tls',
    requireTLS: smtp.secure === 'starttls',
    ignoreTLS: smtp.secure === 'none',
    ...(smtp.auth === undefined ? {} : { auth: { user: smtp.auth.user, pass: smtp.auth.pass } }),
    connectionTimeout: SMTP_TIMEOUTS_MS.connection,
    greetingTimeout: SMTP_TIMEOUTS_MS.greeting,
    socketTimeout: SMTP_TIMEOUTS_MS.socket,
    dnsTimeout: SMTP_TIMEOUTS_MS.dns,
    tls: { minVersion: 'TLSv1.2' },
    logger: logger.child({ component: 'smtp' }, { level: 'warn' }),
    debug: false,
    // This worker sends text it rendered. A message can never make nodemailer read a file or fetch an address.
    disableFileAccess: true,
    disableUrlAccess: true,
  }
}

export interface OutgoingMail {
  readonly from: { readonly address: string; readonly name: string }
  readonly to: string
  readonly subject: string
  readonly text: string
  readonly html: string
}

/** The little the handler needs of a transport, so a test can stand in for the network. */
export interface MailTransport {
  send: (mail: OutgoingMail) => Promise<void>
  close: () => void
}

export type TransportFactory = (smtp: ResolvedSmtp, logger: Logger) => MailTransport

export const createSmtpTransport: TransportFactory = (smtp, logger) => {
  const transporter = nodemailer.createTransport(smtpTransportOptions(smtp, logger))
  return {
    async send(mail) {
      await transporter.sendMail(mail)
    },
    close() {
      transporter.close()
    },
  }
}
