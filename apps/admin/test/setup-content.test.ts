import { describe, expect, it } from 'vitest'

import { defaultContentNames } from '../app/utils/setup-content.ts'
import { DEFAULT_CONTENT_STRINGS } from '../../../packages/db/src/default-content/strings.ts'

// The wizard names what the install makes. The names are the install's own strings; this keeps the two from drifting apart.
describe('defaultContentNames', () => {
  it.each(['nb', 'en'] as const)('are those of the install for %s', (locale) => {
    const strings = DEFAULT_CONTENT_STRINGS[locale]
    expect(defaultContentNames(locale)).toEqual({
      post: strings.postTitle,
      page: strings.samplePageTitle,
      privacyPage: strings.privacyPolicyTitle,
      category: strings.categoryName,
    })
  })

  it('gives every other language the English names, as the install does', () => {
    expect(defaultContentNames('de')).toEqual(defaultContentNames('en'))
  })
})
