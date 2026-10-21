// A small client for Mailpit's REST API (https://mailpit.axllent.org/docs/api-v1/), for the test that sends real mail.
// Mirrors apps/worker/test/mailpit.ts (test code is not shared between packages); see there for how to start Mailpit.
// Without MAILPIT_URL and MAILPIT_SMTP the suite skips and says so, the same pattern as TEST_DATABASE_URL.
import { randomBytes } from 'node:crypto'

import { z } from 'zod'

const Address = z.object({ Name: z.string(), Address: z.string() })
const Summary = z.object({ ID: z.string(), Subject: z.string() })
const Search = z.object({ messages: z.array(Summary) })
const Message = z.object({
  ID: z.string(),
  Subject: z.string(),
  From: Address,
  To: z.array(Address),
  Text: z.string(),
  HTML: z.string(),
})
export type MailpitMessage = z.infer<typeof Message>

export interface MailpitConfig {
  readonly url: string
  readonly smtpHost: string
  readonly smtpPort: number
}

export function mailpitConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): MailpitConfig | undefined {
  const url = env['MAILPIT_URL']
  const smtp = env['MAILPIT_SMTP']
  if (url === undefined || url === '' || smtp === undefined || smtp === '') {
    return undefined
  }
  const colon = smtp.lastIndexOf(':')
  const port = Number(smtp.slice(colon + 1))
  if (colon <= 0 || !Number.isInteger(port)) {
    throw new Error('MAILPIT_SMTP must be host:port')
  }
  return { url: url.replace(/\/+$/, ''), smtpHost: smtp.slice(0, colon), smtpPort: port }
}

export const MAILPIT_SKIP_REASON =
  'skipped: set MAILPIT_URL (e.g. http://127.0.0.1:8025) and MAILPIT_SMTP (e.g. 127.0.0.1:1025) to a throwaway Mailpit'

export function noticeIfMailpitSkipped(suite: string): void {
  if (mailpitConfig() === undefined) {
    process.stderr.write(`[${suite}] ${MAILPIT_SKIP_REASON}\n`)
  }
}

/** An address nobody else's test uses. */
export function uniqueAddress(label: string): string {
  return `${label}-${randomBytes(4).toString('hex')}@mailpit.example.test`
}

async function search(config: MailpitConfig, to: string) {
  const response = await fetch(`${config.url}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)
  if (!response.ok) {
    throw new Error(`Mailpit answered ${String(response.status)}`)
  }
  return Search.parse(await response.json())
}

/** Waits for a message to `to` and returns it whole. Throws after `timeoutMs`. */
export async function waitForMessage(config: MailpitConfig, to: string, timeoutMs = 25_000): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const first = (await search(config, to)).messages[0]
    if (first !== undefined) {
      const response = await fetch(`${config.url}/api/v1/message/${first.ID}`)
      return Message.parse(await response.json())
    }
    if (Date.now() > deadline) {
      throw new Error(`no message to ${to} arrived in Mailpit within ${String(timeoutMs)} ms`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

/** How many messages Mailpit holds for `to` now. */
export async function countMessages(config: MailpitConfig, to: string): Promise<number> {
  return (await search(config, to)).messages.length
}
