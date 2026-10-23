// Asking questions in a terminal, for `toa core install` without flags. The questions go to standard error, so standard output
// carries only the result (the recovery key, a generated password).
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'

export interface AskOptions {
  /** The answer is not shown while it is typed (a password). */
  readonly secret?: boolean
}

/** What a command can ask of the person at the keyboard. Tests pass their own. */
export interface Prompter {
  /** True when there is a person to ask: standard input is a terminal. */
  readonly interactive: boolean
  /** Shows `question` and returns the answer without its line break. */
  ask: (question: string, options?: AskOptions) => Promise<string>
  /** Shows a line of text (why an answer was not accepted). */
  say: (text: string) => void
}

/** Swallows what readline echoes, so a password is not shown. */
const SILENT = new Writable({
  write(_chunk, _encoding, callback) {
    callback()
  },
})

/** The prompter on the process' terminal. */
export function createTerminalPrompter(): Prompter {
  return {
    interactive: process.stdin.isTTY,
    say(text) {
      process.stderr.write(`${text}\n`)
    },
    async ask(question, options) {
      const secret = options?.secret === true
      if (secret) {
        process.stderr.write(question)
      }
      const rl = createInterface({
        input: process.stdin,
        output: secret ? SILENT : process.stderr,
        terminal: true,
      })
      try {
        const answer = secret ? await rl.question('') : await rl.question(question)
        if (secret) {
          process.stderr.write('\n')
        }
        return answer
      } finally {
        rl.close()
      }
    },
  }
}
