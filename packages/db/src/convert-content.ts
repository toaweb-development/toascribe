// A data step of the migration run (M1.4): content stored in WordPress' parsed form (the default content of an install before M1.3,
// later a WXR import that could not convert a block) is turned into toascribe's blocks with @toascribe/blocks fromWordPress, so the
// editor can change it and the site draws it like any other. Idempotent: only rows whose blocks still have `blockName` are read. A
// tree with a block type the converter does not know stays as it is and is logged by id (never its text).
import { fromWordPress, isWordPressTree } from '@toascribe/blocks'
import type pg from 'pg'
import type { Logger } from 'pino'

export async function convertWordPressContent(
  client: Pick<pg.Client, 'query'>,
  logger: Logger,
): Promise<{ converted: number; kept: number }> {
  const { rows } = await client.query<{ id: string; blocks: unknown }>(
    `select id, blocks from content
      where jsonb_typeof(blocks) = 'array' and jsonb_array_length(blocks) > 0 and (blocks -> 0) ? 'blockName'`,
  )
  let converted = 0
  let kept = 0
  for (const row of rows) {
    // One row never stops the run (the api and the worker start after it): whatever goes wrong, the row is kept as it is and
    // logged by id only (an error message could quote its text).
    try {
      const blocks = isWordPressTree(row.blocks) ? fromWordPress(row.blocks) : undefined
      if (blocks === undefined) {
        kept += 1
        logger.warn({ contentId: row.id }, 'content in WordPress block form could not be converted; left as it is')
        continue
      }
      // Each update commits on its own (the run holds no transaction here), so a refused one changes nothing else.
      await client.query('update content set blocks = $2::jsonb where id = $1', [row.id, JSON.stringify(blocks)])
      converted += 1
    } catch {
      kept += 1
      logger.warn({ contentId: row.id }, 'content in WordPress block form could not be stored converted; left as it is')
    }
  }
  return { converted, kept }
}
