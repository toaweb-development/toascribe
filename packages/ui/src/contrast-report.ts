// `pnpm --filter @toascribe/ui contrast`: every colour pair of «Blekk» in both themes, the weakest first. Exit 1 if one is below its
// floor (the same check as test/contrast.test.ts, for a person who changes a colour and wants to see the margins).
import { readFileSync } from 'node:fs'

import { measure } from './contrast.ts'

const css = readFileSync(new URL('../app/assets/theme/tokens/colors.css', import.meta.url), 'utf8')
const rows = measure(css).sort((a, b) => a.ratio - a.min - (b.ratio - b.min))
for (const row of rows) {
  const mark = row.ok ? 'ok  ' : 'FAIL'
  process.stdout.write(
    `${mark} ${row.theme.padEnd(5)} ${row.ratio.toFixed(2).padStart(5)} ≥ ${String(row.min).padEnd(3)} ${row.fg} on ${row.alpha === undefined ? row.bg : `${row.bg}/${String(row.alpha * 100)} over ${row.under ?? 'surface'}`} (${row.use})\n`,
  )
}
process.exitCode = rows.every((row) => row.ok) ? 0 : 1
