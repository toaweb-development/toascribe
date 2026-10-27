// The site's `frame-src` for players (M1.6): the listed hosts as https origins, added to the policy, never a wildcard or a scheme.
import { describe, expect, it } from 'vitest'

import { withFrameHosts } from '../lib/embed-csp'

describe('withFrameHosts', () => {
  it('adds frame-src with the hosts only when there is none', () => {
    expect(
      withFrameHosts("default-src 'none'; frame-ancestors 'self';", ['www.youtube-nocookie.com', 'player.vimeo.com']),
    ).toBe(
      "default-src 'none'; frame-ancestors 'self'; frame-src https://www.youtube-nocookie.com https://player.vimeo.com;",
    )
  })

  it('extends an existing frame-src once per host', () => {
    expect(withFrameHosts("frame-src 'self' https://player.vimeo.com", ['player.vimeo.com', 'mastodon.social'])).toBe(
      "frame-src 'self' https://player.vimeo.com https://mastodon.social;",
    )
  })

  it('leaves out anything that is not a plain host name', () => {
    expect(
      withFrameHosts("default-src 'none'", [
        '*',
        '*.example',
        'https://evil.example',
        "a.example 'unsafe-inline'",
        'x;y',
      ]),
    ).toBe("default-src 'none'")
  })
})
