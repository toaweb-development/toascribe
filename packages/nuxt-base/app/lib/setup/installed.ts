// What the server process remembers between requests: that the site is installed. An installed site stays installed (the
// install is final, and no setup route exists afterwards), so asking the api on every page of a busy site would be a call
// for nothing. "Not installed" is never remembered: the answer changes the moment the wizard finishes.
//
// This is a variable of the server process on purpose, and not `useState` (which lives for one request): it holds one
// boolean that every visitor shares and that can only go from false to true. The browser has no use for it, since the page
// payload carries the answer (`useState('setup:installed')` in the middleware).
//
// One thing can make it stale: `toa dev reset` empties the database under a running app. Restart the app after a reset.
let installed = false

export function installedIsKnown(): boolean {
  return installed
}

export function rememberInstalled(): void {
  installed = true
}
