// The only layer that talks to the database (typescript §8). M0.1 has no tables, so this is
// the connectivity probe from @toascribe/db.
import { checkConnection } from '@toascribe/db'
import type { Db } from '@toascribe/db'

export type Pool = Db['pool']

/** Resolves when the database answers `select 1`; rejects on an error or after timeoutMs. */
export async function pingDatabase(pool: Pool, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`database did not answer within ${String(timeoutMs)} ms`))
    }, timeoutMs)
  })
  try {
    await Promise.race([checkConnection(pool), timeout])
  } finally {
    clearTimeout(timer)
  }
}
