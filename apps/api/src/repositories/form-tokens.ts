// The registration form tokens that have been used (M2.1, K-006). A token is claimed once: the first claim stores its SHA-256 and
// wins, any later one finds it there. Rows that have expired are removed as new ones come, so the table holds an hour at most.
import { createHash } from 'node:crypto'

import { schema } from '@toascribe/db'
import { lt } from 'drizzle-orm'

import type { Executor } from './executor.ts'

const { registerFormUse } = schema

/** True for the first use of the token, false when it was used before. */
export async function claimFormToken(db: Executor, token: string, expiresAt: Date, now: Date): Promise<boolean> {
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const rows = await db
    .insert(registerFormUse)
    .values({ tokenHash, expiresAt })
    .onConflictDoNothing()
    .returning({ tokenHash: registerFormUse.tokenHash })
  await db.delete(registerFormUse).where(lt(registerFormUse.expiresAt, now))
  return rows.length === 1
}
