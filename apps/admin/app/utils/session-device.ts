// The sessions list (K-013): what a browser's `User-Agent` says in a few words, and when. The API keeps the header as it came; a
// person wants «Firefox på Linux», not the whole string. Only the common browsers and systems are named; anything else is left out
// and the row says «Ukjent enhet» (or just the part that is known).

export interface Device {
  browser: string | undefined
  system: string | undefined
}

// Order matters: Edge, Opera and the Chrome look-alikes all say «Chrome» and «Safari» too.
const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\b/, 'Opera'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|Chromium|CriOS|HeadlessChrome)\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
]

// iOS and Android first: both also say «Linux» or «Mac OS X».
const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/\b(?:iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b|\bX11\b/, 'Linux'],
]

export function describeDevice(userAgent: string | null): Device {
  const text = userAgent ?? ''
  return {
    browser: BROWSERS.find(([pattern]) => pattern.test(text))?.[1],
    system: SYSTEMS.find(([pattern]) => pattern.test(text))?.[1],
  }
}

/**
 * «5. okt. 2026, 14:05» (or «Oct 5, 2026, 2:05 PM»), in the admin's language and the browser's time zone. Used only after mount,
 * so the server and the browser never disagree.
 */
export function formatWhen(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}
