// `toa media regenerate` (K-116): makes the sizes of the images again, for example after the sizes in Settings → Media changed. It marks
// the images pending and queues a job per image for the worker, the same job «Lag bildestørrelser på nytt» in the admin queues.
import { createMediaProducer, schema } from '@toascribe/db'
import { RESIZABLE_MIMES } from '@toascribe/media'
import { and, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { UsageError, isCliResult, parseFlags, usageResult, withDatabase } from '../kit.ts'
import type { CommandOptions } from '../options.ts'
import type { CliResult } from '../result.ts'
import { MEDIA_REGENERATE_USAGE } from '../usage.ts'

const { auditLog, media } = schema

/** `toa media regenerate [--id <uuid>]`: every image, or one. */
export async function mediaRegenerate(args: readonly string[], options: CommandOptions = {}): Promise<CliResult> {
  let only: string | undefined
  try {
    const flags = parseFlags(args, { id: 'string' })
    if (flags['id'] !== undefined) {
      const parsed = z.uuid().safeParse(flags['id'])
      if (!parsed.success) {
        throw new UsageError('--id must be the id of a media file.')
      }
      only = parsed.data
    }
  } catch (err) {
    if (err instanceof UsageError) {
      return usageResult(err.message, MEDIA_REGENERATE_USAGE)
    }
    throw err
  }

  const outcome = await withDatabase(options, 'media regenerate', async (db, logger, config) => {
    const now = new Date()
    const ids = await db.transaction(async (tx) => {
      const rows = await tx
        .update(media)
        .set({ processing: 'pending', processingError: null, modifiedAt: now })
        .where(
          and(inArray(media.mime, [...RESIZABLE_MIMES]), only === undefined ? undefined : sql`${media.id} = ${only}`),
        )
        .returning({ id: media.id })
      await tx.insert(auditLog).values({
        actorType: 'system',
        actor: 'cli',
        accountId: null,
        action: 'media.regenerate',
        objectType: 'media',
        objectId: only ?? null,
        newValue: { count: rows.length },
        source: 'cli',
        ip: null,
        createdAt: now,
      })
      return rows.map((row) => row.id)
    })
    const producer = createMediaProducer({
      connectionString: config.DATABASE_URL,
      applicationName: 'toascribe-cli',
      logger,
    })
    try {
      for (const id of ids) {
        await producer.send({ kind: 'regenerate', mediaId: id })
      }
    } finally {
      await producer.stop()
    }
    return ids.length
  })
  if (isCliResult(outcome)) {
    return outcome
  }
  if (only !== undefined && outcome === 0) {
    return { code: 1, stdout: '', stderr: '--id: no image has that id.\n' }
  }
  return { code: 0, stdout: `${String(outcome)} image(s) queued for new sizes. The worker makes them.\n`, stderr: '' }
}
