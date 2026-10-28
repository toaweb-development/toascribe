// The pictures of accounts (M1.8, K-015, K-236): the profile picture from the media library when the account has one that anyone
// may see; otherwise Gravatar when «Personvern» turns it on (off by default: it sends a hash of the e-mail address to a third party);
// otherwise null, and the screen draws the initials.
import { createHash } from 'node:crypto'

import type { Database } from '@toascribe/db'
import { CoreSettings } from '@toascribe/shared'
import type { ContentMediaRef } from '@toascribe/shared'

import { readSettings } from '../repositories/settings.ts'
import type { MediaService } from './media.ts'

const VISITOR = { id: '', capabilities: new Set<string>() } as const
const AvatarSettings = CoreSettings.pick({ avatar_gravatar: true })

/** Gravatar's address for an e-mail: the MD5 of the trimmed, lower-case address, as Gravatar asks; 404 when it has none. */
export function gravatarUrl(email: string, size = 96): string {
  const hash = createHash('md5').update(email.trim().toLowerCase()).digest('hex')
  return `https://secure.gravatar.com/avatar/${hash}?s=${String(size)}&d=404`
}

/** The smallest size of an image, or the original. */
function smallest(ref: ContentMediaRef): string {
  return ref.sizes[0]?.url ?? ref.url
}

export interface AvatarAccount {
  readonly id: string
  readonly email: string
  readonly avatarId: string | null
}

/** The picture of each account, by id (null: draw the initials). Only images anyone may see count as a profile picture. */
export async function avatarUrls(
  db: Database,
  media: Pick<MediaService, 'contentRefs'>,
  accounts: readonly AvatarAccount[],
  onInvalidSetting?: (key: string) => void,
): Promise<Map<string, string | null>> {
  const ids = [...new Set(accounts.flatMap((account) => (account.avatarId === null ? [] : [account.avatarId])))]
  const [refs, settings] = await Promise.all([
    ids.length === 0 ? Promise.resolve([]) : media.contentRefs(VISITOR, ids),
    readSettings(db, AvatarSettings, onInvalidSetting),
  ])
  const images = new Map(refs.filter((ref) => ref.mime.startsWith('image/')).map((ref) => [ref.id, smallest(ref)]))
  return new Map(
    accounts.map((account) => {
      const own = account.avatarId === null ? undefined : images.get(account.avatarId)
      return [account.id, own ?? (settings.avatar_gravatar ? gravatarUrl(account.email) : null)]
    }),
  )
}

/** Whether an image may be a profile picture: in the library, an image, and visible to anyone. */
export async function isPublicImage(media: Pick<MediaService, 'contentRefs'>, id: string): Promise<boolean> {
  const [ref] = await media.contentRefs(VISITOR, [id])
  return ref?.mime.startsWith('image/') === true
}
