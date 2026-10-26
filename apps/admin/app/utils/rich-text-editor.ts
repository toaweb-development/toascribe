import type { AnyExtension, JSONContent } from '@tiptap/core'
import { Bold } from '@tiptap/extension-bold'
import { Code } from '@tiptap/extension-code'
import { Document } from '@tiptap/extension-document'
import { HardBreak } from '@tiptap/extension-hard-break'
import { Italic } from '@tiptap/extension-italic'
import { Link } from '@tiptap/extension-link'
import { Paragraph } from '@tiptap/extension-paragraph'
import { Text } from '@tiptap/extension-text'
import type { Transaction } from '@tiptap/pm/state'
import { AddMarkStep, RemoveMarkStep } from '@tiptap/pm/transform'

import type { InlineNode, TextChangeKind } from '@toascribe/blocks'
import { isSafeHref, normalizeInline } from '@toascribe/blocks'

// What one paragraph's TipTap is made of, apart from its keys (components/editor/Paragraph.vue): a document of exactly one
// paragraph, and only the nodes and marks the block format allows. No UndoRedo: the editor's model keeps the one history.

/** The TipTap extensions of a paragraph block. */
export function richTextExtensions(): AnyExtension[] {
  return [
    Document.extend({ content: 'paragraph' }),
    Paragraph,
    Text,
    HardBreak,
    Bold,
    Italic,
    Code,
    Link.configure({
      openOnClick: false,
      autolink: false,
      linkOnPaste: false,
      // The same check as the block format's: no javascript:, data: or another host by `//`.
      isAllowedUri: (url) => isSafeHref(url),
      HTMLAttributes: { target: null, rel: null, class: null },
    }),
  ]
}

/** A paragraph's stored content as the TipTap document that shows it. */
export function toEditorDoc(nodes: readonly InlineNode[]): JSONContent {
  return { type: 'doc', content: [{ type: 'paragraph', ...(nodes.length > 0 ? { content: [...nodes] } : {}) }] }
}

/** The stored content of what TipTap holds (`editor.getJSON()` or `state.doc.toJSON()`). */
export function fromEditorDoc(doc: JSONContent): InlineNode[] {
  return normalizeInline(doc.content?.[0]?.content)
}

/** A transaction that only adds or removes marks is formatting (a step of its own); anything else is typing (grouped). */
export function changeKind(transaction: Pick<Transaction, 'steps'>): TextChangeKind {
  const formatOnly =
    transaction.steps.length > 0 &&
    transaction.steps.every((step) => step instanceof AddMarkStep || step instanceof RemoveMarkStep)
  return formatOnly ? 'format' : 'text'
}
