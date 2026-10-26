import { z } from 'zod'

import { ApiError } from './errors.ts'

// The editor prototype's endpoints (M0.6, PROTOTYPE). They exist only to show that the block model can be saved and read back;
// the real content API comes in M1.1 and the media library in M1.2, and both replace these. Everything is under
// /api/v1/prototype/editor so it is easy to find and remove.

/** The longest block document the prototype takes, in blocks at the top level (the full check is in @toascribe/blocks). */
export const PROTOTYPE_MAX_TOP_LEVEL_BLOCKS = 5000

/** The prototype draft of the signed-in account: its own draft (one per account), or `id: null` and no blocks before the first save. */
// `blocks` is not the recursive `Blocks` (z.json()): the OpenAPI generator cannot walk a recursive schema. The block format is
// checked by @toascribe/blocks on the way in; on the way out each block is an object.
export const PrototypeDocument = z.object({
  id: z.uuid().nullable(),
  blocks: z.array(z.record(z.string(), z.unknown())),
  updatedAt: z.iso.datetime({ offset: true }).nullable(),
})
export type PrototypeDocument = z.infer<typeof PrototypeDocument>

/** PUT /prototype/editor/document. The blocks are checked against each block's block.json on the server, not by this schema. */
export const SavePrototypeDocumentRequest = z.strictObject({
  blocks: z.array(z.unknown()).max(PROTOTYPE_MAX_TOP_LEVEL_BLOCKS),
})
export type SavePrototypeDocumentRequest = z.infer<typeof SavePrototypeDocumentRequest>

/** One problem with a block document, at a path from the top of the document (indexes, `children`, `attrs` and keys). */
export const BlockIssue = z.object({
  path: z.array(z.union([z.string(), z.int().nonnegative()])),
  code: z.string(),
  message: z.string(),
})
export type BlockIssue = z.infer<typeof BlockIssue>

/** The most issues one answer lists. */
export const MAX_BLOCK_ISSUES = 100

/** 400 `invalid_blocks`: the common error, with the issues. */
export const InvalidBlocksResponse = ApiError.extend({ issues: z.array(BlockIssue).max(MAX_BLOCK_ISSUES) })
export type InvalidBlocksResponse = z.infer<typeof InvalidBlocksResponse>

/** POST /prototype/editor/uploads: where the image can be fetched (a path on this site). */
export const PrototypeUploadResponse = z.object({ url: z.string().startsWith('/api/v1/prototype/editor/uploads/') })
export type PrototypeUploadResponse = z.infer<typeof PrototypeUploadResponse>

/** The name of an uploaded image: a random UUID and the extension of the type found in its bytes. */
export const PROTOTYPE_UPLOAD_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/
