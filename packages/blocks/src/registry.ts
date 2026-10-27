// The core blocks (M0.6 prototype, M1.3 the basic set of PLAN «Standard blokksett»). Each block's `block.json` is the one source; the
// editor, the api and the views read it from here. The order is the inserter's.
import buttonJson from './button/block.json' with { type: 'json' }
import buttonsJson from './buttons/block.json' with { type: 'json' }
import codeJson from './code/block.json' with { type: 'json' }
import embedJson from './embed/block.json' with { type: 'json' }
import columnJson from './column/block.json' with { type: 'json' }
import columnsJson from './columns/block.json' with { type: 'json' }
import galleryJson from './gallery/block.json' with { type: 'json' }
import globalSetJson from './global-set/block.json' with { type: 'json' }
import groupJson from './group/block.json' with { type: 'json' }
import headingJson from './heading/block.json' with { type: 'json' }
import htmlJson from './html/block.json' with { type: 'json' }
import imageJson from './image/block.json' with { type: 'json' }
import listJson from './list/block.json' with { type: 'json' }
import listItemJson from './list-item/block.json' with { type: 'json' }
import moreJson from './more/block.json' with { type: 'json' }
import nextpageJson from './nextpage/block.json' with { type: 'json' }
import paragraphJson from './paragraph/block.json' with { type: 'json' }
import preformattedJson from './preformatted/block.json' with { type: 'json' }
import queryJson from './query/block.json' with { type: 'json' }
import quoteJson from './quote/block.json' with { type: 'json' }
import separatorJson from './separator/block.json' with { type: 'json' }
import spacerJson from './spacer/block.json' with { type: 'json' }
import tableJson from './table/block.json' with { type: 'json' }
import { BlockDefinition } from './definition.ts'

export const PARAGRAPH = 'core/paragraph'
export const HEADING = 'core/heading'
export const LIST = 'core/list'
export const LIST_ITEM = 'core/list-item'
export const QUOTE = 'core/quote'
export const CODE = 'core/code'
export const PREFORMATTED = 'core/preformatted'
export const TABLE = 'core/table'
export const IMAGE = 'core/image'
export const GALLERY = 'core/gallery'
export const BUTTONS = 'core/buttons'
export const BUTTON = 'core/button'
export const COLUMNS = 'core/columns'
export const COLUMN = 'core/column'
export const GROUP = 'core/group'
export const SEPARATOR = 'core/separator'
export const SPACER = 'core/spacer'
export const MORE = 'core/more'
export const NEXTPAGE = 'core/nextpage'
export const HTML = 'core/html'
export const QUERY = 'core/query'
export const GLOBAL_SET = 'core/global-set'
export const EMBED = 'core/embed'

/** Parsed when the module loads: a block.json that does not fit the definition schema stops the api and the editor at once. */
export const CORE_BLOCKS: readonly BlockDefinition[] = [
  paragraphJson,
  headingJson,
  listJson,
  listItemJson,
  quoteJson,
  codeJson,
  preformattedJson,
  tableJson,
  imageJson,
  galleryJson,
  buttonsJson,
  buttonJson,
  columnsJson,
  columnJson,
  groupJson,
  separatorJson,
  spacerJson,
  moreJson,
  nextpageJson,
  htmlJson,
  queryJson,
  globalSetJson,
  embedJson,
].map((json) => BlockDefinition.parse(json))

const BY_NAME = new Map(CORE_BLOCKS.map((definition) => [definition.name, definition]))

export function getBlockDefinition(name: string): BlockDefinition | undefined {
  return BY_NAME.get(name)
}

/**
 * True when a block of type `child` may stand directly in `parent` (`null` for the top level of a document): the parent's
 * `allowedBlocks` lists it, and the child's `parent`, if it has one, names the parent. A block with a `parent` is never top-level.
 */
export function canContain(parent: string | null, child: string): boolean {
  const childDefinition = BY_NAME.get(child)
  if (childDefinition === undefined) {
    return false
  }
  if (parent === null) {
    return childDefinition.parent === null
  }
  if (BY_NAME.get(parent)?.allowedBlocks.includes(child) !== true) {
    return false
  }
  return childDefinition.parent === null || childDefinition.parent.includes(parent)
}

/** The blocks an inserter offers for a place: the ones that may stand there, in the registry's order. */
export function insertableBlocks(parent: string | null): BlockDefinition[] {
  return CORE_BLOCKS.filter((definition) => canContain(parent, definition.name))
}
