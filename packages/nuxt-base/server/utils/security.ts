/** `X-Forwarded-Proto` says the browser used https: then HSTS (security §7), for a year and for subdomains. */
export function hstsFor(forwardedProto: string | undefined): string | undefined {
  return forwardedProto === 'https' ? 'max-age=31536000; includeSubDomains' : undefined
}

/**
 * Iconify writes an empty `style=""` on every server-rendered <svg>. A CSP without 'unsafe-inline' in style-src-attr blocks a
 * style attribute even when it is empty, and reports it. An empty attribute does nothing, so it is taken out; one that has
 * a value is left alone (and would be blocked, which is the point).
 */
export function withoutEmptyStyleAttributes(html: string): string {
  return html.replaceAll(' style=""', '')
}
