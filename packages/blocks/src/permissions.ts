// Who may use which block (M1.3): a block.json may name a capability (`core/html`: `unfiltered_html`) and the content types it
// belongs in (`core/more`: posts). The api checks a document against the one stored before it (PLAN «Regler for blokker» 2, K-088):
// someone without the capability may keep, move or delete a block that is there, but never add one or change it, so the same check
// holds for a request that skipped the editor. The editor runs it too, to draw such a block read-only.
import type { Block } from './block.ts'
import { flatten } from './tree.ts'
import { getBlockDefinition } from './registry.ts'
import type { ValidationIssue } from './validate.ts'

export interface BlockActor {
  /** The account's capabilities. */
  readonly capabilities: ReadonlySet<string>
  /** The content type of the document (`post`, `page`). */
  readonly contentType: string
}

/** The issue codes of this check (beside those of validateDocument). */
export type PermissionIssueCode = 'capability_required' | 'wrong_content_type'

export interface PermissionIssue extends Omit<ValidationIssue, 'code'> {
  readonly code: PermissionIssueCode
}

/** True when the account may add a block of this type or change one (it needs no capability, or has the one it needs). */
export function mayEditBlockType(type: string, capabilities: ReadonlySet<string>): boolean {
  const needed = getBlockDefinition(type)?.capability
  return needed === undefined || capabilities.has(needed)
}

/** True when the block type belongs in this content type. */
export function allowedInContentType(type: string, contentType: string): boolean {
  const types = getBlockDefinition(type)?.contentTypes
  return types === undefined || types.some((allowed) => allowed === contentType)
}

/**
 * The blocks of `next` the actor may not have there: a block of a type that does not belong in the content type, or a block whose
 * type needs a capability the actor lacks, unless the same block (same id, same type, same attributes) was in `previous`. Run it on
 * a document that passed validateDocument; `previous` is the stored one (empty for a new item).
 */
export function permissionIssues(
  next: readonly Block[],
  previous: readonly Block[],
  actor: BlockActor,
): PermissionIssue[] {
  const before = new Map(flatten(previous).map((block) => [block.id, block]))
  const issues: PermissionIssue[] = []
  const visit = (blocks: readonly Block[], path: (string | number)[]) => {
    blocks.forEach((block, index) => {
      const here = [...path, index]
      if (!allowedInContentType(block.type, actor.contentType)) {
        issues.push({
          path: [...here, 'type'],
          code: 'wrong_content_type',
          message: `${block.type} cannot be used in a ${actor.contentType}`,
        })
      }
      if (!mayEditBlockType(block.type, actor.capabilities)) {
        const old = before.get(block.id)
        const same = old?.type === block.type && JSON.stringify(old.attrs) === JSON.stringify(block.attrs)
        if (!same) {
          issues.push({
            path: [...here, 'type'],
            code: 'capability_required',
            message: `Only accounts with ${getBlockDefinition(block.type)?.capability ?? ''} may add or change ${block.type}`,
          })
        }
      }
      visit(block.children, [...here, 'children'])
    })
  }
  visit(next, [])
  return issues
}
