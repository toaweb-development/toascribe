import AxeBuilder from '@axe-core/playwright'
import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'

// What every test gets for free: a failing test when the page writes anything to the console (errors, warnings, uncaught
// exceptions) or the browser reports a CSP violation. A test that makes the API refuse something on purpose (a wrong
// password is a 401, and the browser logs a failed request as an error) says so with `allowFailedRequests()`.

interface Fixtures {
  /** Call in a test that provokes a 4xx answer on purpose. Failed requests are then not counted; everything else still is. */
  allowFailedRequests: () => void
  /** Call in a test of maintenance mode (M1.7): its 503 answers are then not counted (only those). */
  allowMaintenance: () => void
}

/** The tests that said a refusal is expected, and those that expect maintenance mode's 503. */
const allowed = new Set<string>()
const maintenance = new Set<string>()

const FAILED_REQUEST = /Failed to load resource: the server responded with a status of 4\d\d/
const SERVICE_UNAVAILABLE = /Failed to load resource: the server responded with a status of 503/

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures a function needs from its first argument, and this needs none
  allowFailedRequests: async ({}, use) => {
    // The flag is read after the test body, by `page` below.
    await use(() => {
      allowed.add(test.info().testId)
    })
  },
  // eslint-disable-next-line no-empty-pattern -- as above
  allowMaintenance: async ({}, use) => {
    await use(() => {
      maintenance.add(test.info().testId)
    })
  },
  page: async ({ page }, use, testInfo) => {
    const problems: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        problems.push(`${message.type()}: ${message.text()}`)
      }
    })
    page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`))
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (event) => {
        console.error(
          `CSP violation: ${event.violatedDirective} ${event.blockedURI} ${event.sourceFile}:${event.lineNumber}`,
        )
      })
    })
    await use(page)
    const tolerated = allowed.has(testInfo.testId)
    const inMaintenance = maintenance.has(testInfo.testId)
    const counted = problems.filter(
      (problem) =>
        !(tolerated && FAILED_REQUEST.test(problem)) && !(inMaintenance && SERVICE_UNAVAILABLE.test(problem)),
    )
    expect(counted, 'the console must stay empty').toEqual([])
  },
})

export { expect }

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

/** axe-core with the WCAG 2.2 AA rule sets on the page as it is now. The names say what failed and where. */
export async function expectNoAxeViolations(page: Page, screen: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  const found = results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? '?'}): ${violation.help}\n    ${violation.nodes.map((node) => node.target.join(' ')).join('\n    ')}`,
  )
  expect(found, `axe on ${screen}`).toEqual([])
}
