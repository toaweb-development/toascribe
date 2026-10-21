/** The PostgreSQL error behind an error from the driver or from Drizzle (which wraps it in `cause`), if there is one. */
function postgresError(err: unknown): { code?: unknown; constraint?: unknown } | undefined {
  let current: unknown = err
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    if ('code' in current && typeof current.code === 'string' && /^[0-9A-Z]{5}$/.test(current.code)) {
      return current
    }
    current = 'cause' in current ? current.cause : undefined
  }
  return undefined
}

/** The name of the unique constraint a statement broke (SQLSTATE 23505), or undefined for any other error. */
export function uniqueViolation(err: unknown): string | undefined {
  const found = postgresError(err)
  if (found?.code !== '23505') {
    return undefined
  }
  return typeof found.constraint === 'string' ? found.constraint : ''
}
