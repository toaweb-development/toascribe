// The admin's language (M1.8, K-330): the account's own choice on the profile, else the site's language, else bokmål. A language
// the admin has no messages for is passed over; a regional tag (en-GB) counts as its language (en).
import { AdminLocale } from '@toascribe/shared'

export function pickAdminLocale(own: string | null | undefined, site: string | null | undefined): AdminLocale {
  for (const tag of [own, site]) {
    const parsed = AdminLocale.safeParse(tag?.split('-')[0]?.toLowerCase())
    if (parsed.success) return parsed.data
  }
  return 'nb'
}
