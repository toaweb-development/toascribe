import { expect, test } from './helpers/fixtures.ts'
import { signIn } from './helpers/screens.ts'
import { createUser } from './helpers/stack.ts'

// The block editor with 200 blocks (M0.6, on a post since M1.1): how long the page takes until every paragraph has its TipTap, and how long a
// keystroke, a move and an undo take in the browser (Event Timing API: the time from the key to the next paint). The numbers
// are written to the test output and go into docs/decisions/0001-editor-model.md. They are not a gate; the limits below only
// catch a model that has become unusable.

const BLOCKS = 200
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

function document200(): unknown[] {
  const text = (n: number) => [
    { type: 'text', text: `Avsnitt ${String(n)} med litt tekst, ` },
    { type: 'text', text: 'fet', marks: [{ type: 'bold' }] },
    { type: 'text', text: ' og en ' },
    { type: 'text', text: 'lenke', marks: [{ type: 'link', attrs: { href: 'https://example.com/' } }] },
    { type: 'text', text: '.' },
  ]
  const paragraph = (n: number) => ({
    id: `b_perf${String(n).padStart(4, '0')}`,
    type: 'core/paragraph',
    version: 1,
    attrs: { content: text(n) },
    children: [],
  })
  const blocks: unknown[] = []
  // 180 paragraphs at the top, and 10 columns blocks of two columns with one paragraph each: 200 text blocks, 230 blocks in all.
  for (let n = 0; n < 180; n += 1) {
    blocks.push(paragraph(n))
    if (n % 18 === 17) {
      const k = blocks.length
      blocks.push({
        id: `b_cols${String(k).padStart(4, '0')}`,
        type: 'core/columns',
        version: 1,
        attrs: {},
        children: [0, 1].map((c) => ({
          id: `b_col${String(k).padStart(4, '0')}${String(c)}`,
          type: 'core/column',
          version: 1,
          attrs: {},
          children: [paragraph(1000 + k * 2 + c)],
        })),
      })
    }
  }
  return blocks
}

test('200 text blocks: load, typing, moving and undo stay quick', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const user = await createUser('editor', 'blockperf')
  await signIn(page, user)
  const session = (await (await page.request.get('/api/v1/auth/session')).json()) as { csrfToken: string }
  const saved = await page.request.post('/api/v1/content', {
    data: { type: 'post', title: '200 blokker', blocks: document200() },
    headers: { 'X-CSRF-Token': session.csrfToken, origin: new URL(page.url()).origin },
  })
  expect(saved.ok(), await saved.text()).toBe(true)
  const { id } = (await saved.json()) as { id: string }

  // Event timing for every key from the start of the page.
  await page.addInitScript(() => {
    const entries: { name: string; duration: number; processing: number }[] = []
    Reflect.set(window, '__eventTimings', entries)
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceEventTiming[]) {
        entries.push({
          name: entry.name,
          duration: entry.duration,
          processing: entry.processingEnd - entry.processingStart,
        })
      }
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit)
  })

  // E2E_CPU_THROTTLE=4 slows the browser's CPU four times (Chrome DevTools Protocol), for a weaker laptop than the test machine.
  const throttle = Number(process.env['E2E_CPU_THROTTLE'] ?? '1')
  if (throttle > 1) {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle })
  }

  const started = Date.now()
  await page.goto(`/admin/posts/${id}`)
  await expect(page.locator('[contenteditable="true"]')).toHaveCount(BLOCKS, { timeout: 60_000 })
  const loadMs = Date.now() - started
  const navigation = await page.evaluate(() => {
    const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]
    return {
      domContentLoaded: Math.round(entry?.domContentLoadedEventEnd ?? 0),
      load: Math.round(entry?.loadEventEnd ?? 0),
    }
  })

  type Timing = { name: string; duration: number; processing: number }
  const timings = () => page.evaluate(() => Reflect.get(window, '__eventTimings') as Timing[])
  /** The key events of one phase: from `start` (an index into the entries) to now. Event Timing reports only those over 16 ms. */
  async function phase(start: number) {
    const entries = (await timings())
      .slice(start)
      .filter((entry) => ['keydown', 'keypress', 'input'].includes(entry.name))
    const durations = entries.map((entry) => entry.duration).sort((a, b) => a - b)
    const at = (p: number) => durations[Math.min(durations.length - 1, Math.floor((p / 100) * durations.length))] ?? 0
    return { eventsOver16ms: durations.length, p50: at(50), p95: at(95), max: durations.at(-1) ?? 0 }
  }

  const target = page.getByRole('textbox', { name: 'Avsnitt' }).nth(100)
  await target.click()
  await page.keyboard.press('End')
  const sentence = ' Litt mer tekst skrevet midt i dokumentet.'
  let mark = (await timings()).length
  const typingStarted = Date.now()
  await page.keyboard.type(sentence, { delay: 20 })
  const typingMs = Date.now() - typingStarted
  await expect(target).toContainText('skrevet midt i dokumentet.')
  const typing = await phase(mark)

  mark = (await timings()).length
  for (let step = 0; step < 5; step += 1) await page.keyboard.press('Alt+Shift+ArrowUp')
  const moving = await phase(mark)

  mark = (await timings()).length
  for (let step = 0; step < 6; step += 1) await page.keyboard.press(`${MOD}+z`)
  await expect(page.getByRole('textbox', { name: 'Avsnitt' }).nth(100)).not.toContainText('skrevet midt')
  const undoing = await phase(mark)

  const heapMb = await page.evaluate(() => {
    const memory: unknown = Reflect.get(performance, 'memory')
    const used: unknown =
      typeof memory === 'object' && memory !== null ? Reflect.get(memory, 'usedJSHeapSize') : undefined
    return typeof used === 'number' ? Math.round(used / 1024 / 1024) : null
  })
  const result = {
    project: testInfo.project.name,
    cpuThrottle: throttle,
    textBlocks: BLOCKS,
    pageReadyMs: loadMs,
    navigation,
    heapMb,
    typing: { characters: sentence.length, wallMs: typingMs, delayPerKeyMs: 20, ...typing },
    moving: { steps: 5, ...moving },
    undoing: { steps: 6, ...undoing },
  }
  await testInfo.attach('editor-performance.json', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  })
  process.stdout.write(`editor-performance ${JSON.stringify(result)}\n`)

  // Not a benchmark gate: these limits only catch a model that has become unusable.
  expect(loadMs).toBeLessThan(30_000)
  for (const measured of [typing, moving, undoing]) {
    expect(measured.max).toBeLessThan(1000)
  }
})
