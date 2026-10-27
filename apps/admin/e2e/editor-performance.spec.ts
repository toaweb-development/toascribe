import { expect, test } from './helpers/fixtures.ts'
import { signIn } from './helpers/screens.ts'
import { createUser } from './helpers/stack.ts'

// The block editor with 200 blocks of mixed types (M0.6, M1.3): how long the page takes until every block is drawn, and how long a
// keystroke, a move and an undo take in the browser (Event Timing API: the time from the key to the next paint). The numbers
// are written to the test output and go into docs/decisions/0001-editor-model.md. They are not a gate; the limits below only
// catch a model that has become unusable.

const BLOCKS = 200
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

/**
 * 200 blocks of mixed types (M1.3): in each of 13 rounds a paragraph, a heading, a list of two items, a quote with a paragraph, a
 * table, a code block, a separator and two columns with a paragraph each (15 blocks), and 5 paragraphs at the end. Every paragraph has
 * bold text and a link.
 */
function document200(): unknown[] {
  let serial = 0
  const id = (kind: string) => `b_${kind}${String((serial += 1)).padStart(5, '0')}`
  const text = (n: number) => [
    { type: 'text', text: `Avsnitt ${String(n)} med litt tekst, ` },
    { type: 'text', text: 'fet', marks: [{ type: 'bold' }] },
    { type: 'text', text: ' og en ' },
    { type: 'text', text: 'lenke', marks: [{ type: 'link', attrs: { href: 'https://example.com/' } }] },
    { type: 'text', text: '.' },
  ]
  const block = (type: string, attrs: Record<string, unknown>, children: unknown[] = []) => ({
    id: id(type.replace('core/', '').replace('-', '')),
    type,
    version: 1,
    attrs,
    children,
  })
  const paragraph = (n: number) => block('core/paragraph', { content: text(n) })
  const blocks: unknown[] = []
  for (let round = 0; round < 13; round += 1) {
    blocks.push(
      paragraph(round),
      block('core/heading', { level: 2, content: [{ type: 'text', text: `Overskrift ${String(round)}` }] }),
      block('core/list', { ordered: round % 2 === 0 }, [
        block('core/list-item', { content: [{ type: 'text', text: 'Første punkt' }] }),
        block('core/list-item', { content: [{ type: 'text', text: 'Andre punkt' }] }),
      ]),
      block('core/quote', { citation: [{ type: 'text', text: 'Kilde' }] }, [paragraph(100 + round)]),
      block('core/table', {
        hasHeader: true,
        cells: [
          [[{ type: 'text', text: 'A' }], [{ type: 'text', text: 'B' }]],
          [[{ type: 'text', text: '1' }], [{ type: 'text', text: '2' }]],
        ],
        caption: '',
      }),
      block('core/code', { content: `const runde = ${String(round)}` }),
      block('core/separator', {}),
      block('core/columns', {}, [
        block('core/column', {}, [paragraph(200 + round)]),
        block('core/column', {}, [paragraph(300 + round)]),
      ]),
    )
  }
  for (let n = 0; n < 5; n += 1) blocks.push(paragraph(400 + n))
  return blocks
}

test('200 blocks of mixed types: load, typing, moving and undo stay quick', async ({ page }, testInfo) => {
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
  // Ready: every block drawn in the editor (its text as the site draws it; TipTap is made at the first focus, M1.3).
  await expect(page.locator('[data-block-id]')).toHaveCount(BLOCKS, { timeout: 60_000 })
  const loadMs = Date.now() - started
  // TipTap instances made at load: none, they come with the focus.
  const tiptapAtLoad = await page.locator('[contenteditable="true"]').count()
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

  const target = page.getByRole('textbox', { name: 'Avsnitt' }).nth(30)
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
  await expect(page.getByText('skrevet midt i dokumentet.')).toHaveCount(0)
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
    blocks: BLOCKS,
    tiptapAtLoad,
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
