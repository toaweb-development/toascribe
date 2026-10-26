// The media jobs' producer of the api: the one in @toascribe/db, which the cli uses too.
import { createMediaProducer } from '@toascribe/db'
import type { MediaProducer } from '@toascribe/db'
import type { Logger } from 'pino'

export type MediaQueue = MediaProducer

export function createMediaQueue(deps: { readonly connectionString: string; readonly logger: Logger }): MediaQueue {
  return createMediaProducer({ ...deps, applicationName: 'toascribe-api-media' })
}
