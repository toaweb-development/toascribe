// core/image, version 1 → 2 (M1.2). Version 1 (the M0.6 prototype) stored an address (`url`); version 2 stores the media library's
// id (`mediaId`), and the address is worked out when the image is shown (PLAN «Besluttet»: «Bildeblokken lagrer mediaId»). An address
// the library knows (a file of this site under /uploads/) becomes its id; any other address (an outside image, or one of the
// prototype's temporary uploads, which are gone) leaves the block without an image to choose again. The alt text and the caption stay.
import type { MigrationContext } from '../migrate.ts'

export function migrateImageV1(
  attrs: Readonly<Record<string, unknown>>,
  context: MigrationContext,
): Record<string, unknown> {
  const url = typeof attrs['url'] === 'string' ? attrs['url'] : ''
  const mediaId = url === '' ? undefined : context.mediaIdForUrl(url)
  return {
    mediaId: mediaId ?? '',
    alt: typeof attrs['alt'] === 'string' ? attrs['alt'] : '',
    caption: typeof attrs['caption'] === 'string' ? attrs['caption'] : '',
    decorative: false,
  }
}
