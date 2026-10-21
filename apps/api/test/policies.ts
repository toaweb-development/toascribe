// The routes of the api and who may call each, written out by hand. test/policy.test.ts compares it with what the app has
// registered; the role matrix test compares what each role gets with it.

/** Every route of the api and its policy. Adding a route means adding a line here: that is the point. */
export const EXPECTED_POLICIES: Readonly<Record<string, string>> = {
  'GET /api/health': 'public',
  'GET /api/ready': 'public',
  'GET /api/v1/openapi.json': 'public',
  'POST /api/v1/auth/login': 'public',
  'GET /api/v1/auth/session': 'public',
  'POST /api/v1/auth/logout': 'authenticated (also half-signed-in)',
  'GET /api/v1/auth/options': 'public',
  'POST /api/v1/auth/password/lost': 'public',
  'POST /api/v1/auth/password/reset': 'public',
  'POST /api/v1/auth/password/set': 'public',
  'POST /api/v1/auth/register': 'public',
  'POST /api/v1/auth/mfa/verify': 'authenticated (also half-signed-in)',
  'GET /api/v1/me': 'capability:read',
  'PATCH /api/v1/me': 'capability:read',
  'GET /api/v1/me/sessions': 'capability:read',
  'DELETE /api/v1/me/sessions/:id': 'capability:read',
  'DELETE /api/v1/me/sessions': 'capability:read',
  'GET /api/v1/me/mfa': 'capability:read',
  'POST /api/v1/me/mfa/totp': 'authenticated (also half-signed-in)',
  'POST /api/v1/me/mfa/totp/:id/confirm': 'authenticated (also half-signed-in)',
  'DELETE /api/v1/me/mfa/:id': 'capability:read',
  'POST /api/v1/me/mfa/recovery-codes': 'capability:read',
  'PATCH /api/v1/me/password': 'capability:read',
  'POST /api/v1/me/email-change': 'capability:read',
  'POST /api/v1/me/email-change/confirm': 'capability:read',
  'POST /api/v1/system/test-email': 'capability:manage_options',
}
