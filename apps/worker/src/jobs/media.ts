// The media jobs (M1.2; PLAN «Besluttet»: sharp, in the worker only). For an uploaded or replaced image the worker makes WordPress'
// sizes as WebP, and a `-scaled` copy of an original over 2560 pixels; «Rediger bilde» makes a new edited image from the steps and the
// sizes of it; «Lag bildestørrelser på nytt» makes the sizes again (after a change of the sizes in the settings). The original file is
// never changed. Each job locks its media row for the work, so two jobs of one file never write at once; the decoding is limited to the
// pixel limit of the settings (sharp's limitInputPixels), so a file that got past the api's header check still cannot fill the memory.
import type { Database } from '@toascribe/db'
import { schema } from '@toascribe/db'
import { RESIZABLE_MIMES, createLocalStorage, defaultSizes, derivedKey, planSizes } from '@toascribe/media'
import type { MediaStorage, PlannedSize } from '@toascribe/media'
import { CoreSettings, MEDIA_QUEUE, MediaJob, MediaVariantsData } from '@toascribe/shared'
import type { MediaEditOperation, MediaVariant } from '@toascribe/shared'
import { eq, sql } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import type { Logger } from 'pino'
import sharp from 'sharp'

import { summarizeError } from '../lib/redact.ts'
import { readSettings } from '../repositories/settings.ts'

const { media } = schema

// No cache of decoded images between jobs: each job is one image, and the memory is the worker's only limit.
sharp.cache(false)

/** WebP quality for the sizes (WordPress' default for WebP is 86; the house standard for photos 82). */
export const WEBP_QUALITY = 82

const MEDIA_SETTINGS = CoreSettings.pick({
  thumbnail_size_w: true,
  thumbnail_size_h: true,
  thumbnail_crop: true,
  medium_size_w: true,
  medium_size_h: true,
  large_size_w: true,
  large_size_h: true,
  image_max_pixels: true,
})

export interface MediaJobDeps {
  readonly db: Database
  readonly logger: Logger
  /** The uploads folder (UPLOADS_DIR); tests pass their own. */
  readonly uploadsDir: string
  readonly now?: () => Date
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

interface Source {
  readonly bytes: Uint8Array
  readonly width: number
  readonly height: number
}

/** Decodes with the site's pixel limit and EXIF orientation applied (sharp's autoOrient). */
function decode(bytes: Uint8Array, maxPixels: number) {
  return sharp(bytes, { limitInputPixels: maxPixels, failOn: 'error', autoOrient: true, animated: false })
}

async function makeVariant(
  storage: MediaStorage,
  source: Source,
  size: PlannedSize,
  key: string,
  maxPixels: number,
): Promise<MediaVariant> {
  const pipeline = decode(source.bytes, maxPixels).resize({
    width: size.width,
    height: size.height,
    fit: size.crop ? 'cover' : 'inside',
    position: 'centre',
    withoutEnlargement: true,
  })
  const { data, info } = await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer({ resolveWithObject: true })
  await storage.put(key, data)
  return { key, width: info.width, height: info.height, size: data.length, mime: 'image/webp' }
}

/** Applies the edit steps in order and returns the edited image as WebP at its full size. */
async function applyEdit(
  bytes: Uint8Array,
  operations: readonly MediaEditOperation[],
  maxPixels: number,
): Promise<Buffer> {
  let current = await decode(bytes, maxPixels).toBuffer()
  for (const step of operations) {
    const image = sharp(current, { limitInputPixels: maxPixels })
    switch (step.op) {
      case 'crop':
        current = await image.extract({ left: step.x, top: step.y, width: step.width, height: step.height }).toBuffer()
        break
      case 'rotate':
        current = await image.rotate(step.degrees).toBuffer()
        break
      case 'flip':
        current = await (step.direction === 'vertical' ? image.flip() : image.flop()).toBuffer()
        break
      case 'scale':
        current = await image.resize({ width: step.width, withoutEnlargement: true }).toBuffer()
        break
      default:
        step satisfies never
    }
  }
  return sharp(current, { limitInputPixels: maxPixels }).webp({ quality: WEBP_QUALITY }).toBuffer()
}

function allKeys(variants: MediaVariantsData): string[] {
  return [
    ...Object.values(variants.sizes).map((size) => size.key),
    ...(variants.scaled === undefined ? [] : [variants.scaled.key]),
    ...(variants.edited === undefined ? [] : [variants.edited.key]),
  ]
}

/** Runs one media job. Throws when it fails (pg-boss tries it again); the row says `failed` with the reason until a try succeeds. */
export async function runMediaJob(deps: MediaJobDeps, input: unknown): Promise<void> {
  const job = MediaJob.parse(input)
  const storage = createLocalStorage(deps.uploadsDir)
  const now = (deps.now ?? (() => new Date()))()
  const settings = await readSettings(deps.db, MEDIA_SETTINGS)
  let stale: string[]
  try {
    stale = await deps.db.transaction(async (tx: Tx) => {
      const [row] = await tx
        .select({
          id: media.id,
          mime: media.mime,
          storageKey: media.storageKey,
          variants: media.variants,
        })
        .from(media)
        .where(eq(media.id, job.mediaId))
        .for('update')
      if (row === undefined || !RESIZABLE_MIMES.has(row.mime)) {
        // Deleted meanwhile, or not an image: nothing to do.
        return []
      }
      const before = MediaVariantsData.catch({ sizes: {} }).parse(row.variants)
      const original = await storage.read(row.storageKey)
      const meta = await decode(original, settings.image_max_pixels).metadata()
      const oriented = meta.autoOrient
      const variants: MediaVariantsData = { sizes: {} }

      // The image the sizes are cut from: a new edit, the edit kept from before, or the original.
      let source: Source = { bytes: original, width: oriented.width, height: oriented.height }
      if (job.kind === 'edit') {
        const shown = before.edited !== undefined ? await storage.read(before.edited.key) : original
        const edited = await applyEdit(shown, job.operations, settings.image_max_pixels)
        const info = await sharp(edited).metadata()
        const key = derivedKey(row.storageKey, `e${String(now.getTime())}`)
        await storage.put(key, edited)
        variants.edited = {
          key,
          width: info.width,
          height: info.height,
          size: edited.length,
          mime: 'image/webp',
          operations: [...(before.edited?.operations ?? []), ...job.operations],
          at: now.toISOString(),
        }
        source = { bytes: edited, width: info.width, height: info.height }
      } else if (before.edited !== undefined) {
        variants.edited = before.edited
        source = {
          bytes: await storage.read(before.edited.key),
          width: before.edited.width,
          height: before.edited.height,
        }
      }

      const plan = planSizes(source.width, source.height, defaultSizes(settings))
      for (const size of plan.sizes) {
        variants.sizes[size.name] = await makeVariant(
          storage,
          source,
          size,
          derivedKey(row.storageKey, `${String(size.width)}x${String(size.height)}`),
          settings.image_max_pixels,
        )
      }
      // WordPress' -scaled copy: of the original only (an edited image is shown as it is).
      if (variants.edited === undefined && plan.scaled !== undefined) {
        variants.scaled = await makeVariant(
          storage,
          source,
          { ...plan.scaled, name: 'scaled' },
          derivedKey(row.storageKey, 'scaled'),
          settings.image_max_pixels,
        )
      }
      await tx
        .update(media)
        .set({
          variants: JSON.parse(JSON.stringify(variants)) as Record<string, never>,
          width: oriented.width,
          height: oriented.height,
          processing: 'ready',
          processingError: null,
          modifiedAt: now,
        })
        .where(eq(media.id, row.id))
      const kept = new Set(allKeys(variants))
      return allKeys(before).filter((key) => !kept.has(key))
    })
  } catch (err) {
    const summary = summarizeError(err)
    deps.logger.error({ job: MEDIA_QUEUE, kind: job.kind, mediaId: job.mediaId, err: summary }, 'media job failed')
    await deps.db
      .update(media)
      .set({ processing: 'failed', processingError: summary.message.slice(0, 500), modifiedAt: now })
      .where(eq(media.id, job.mediaId))
    throw err
  }
  for (const key of stale) {
    await storage.remove(key).catch(() => undefined)
  }
  deps.logger.info({ job: MEDIA_QUEUE, kind: job.kind, mediaId: job.mediaId }, 'media job done')
}

/** The media queue as the api creates it: stately, so a file has at most one waiting job per kind. */
export { MEDIA_QUEUE_OPTIONS } from '@toascribe/db'

export const MEDIA_SWEEP = 'media.sweep'
/** A file pending this long without being done has lost its job (the api could not queue it): the sweep queues it again. */
export const SWEEP_AFTER_MINUTES = 10

/** Queues a `process` job for every image left pending for SWEEP_AFTER_MINUTES. The queue's key per file stops a second one. */
export async function sweepPending(
  deps: { readonly db: Database; readonly logger: Logger; readonly now?: () => Date },
  boss: Pick<PgBoss, 'send'>,
): Promise<number> {
  const now = (deps.now ?? (() => new Date()))()
  const cutoff = new Date(now.getTime() - SWEEP_AFTER_MINUTES * 60_000)
  const rows = await deps.db.execute<{ id: string }>(
    sql`select id from media where processing = 'pending' and modified_at < ${cutoff} order by modified_at limit 500`,
  )
  for (const row of rows.rows) {
    await boss.send(MEDIA_QUEUE, { kind: 'process', mediaId: row.id }, { singletonKey: `process:${row.id}` })
  }
  if (rows.rows.length > 0) {
    deps.logger.info({ job: MEDIA_SWEEP, queued: rows.rows.length }, 'pending media queued again')
  }
  return rows.rows.length
}
