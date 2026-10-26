import { z } from 'zod'

// The editor prototype's image uploads (M0.6, PROTOTYPE). The prototype's own draft is gone since M1.1 (the editor saves through the
// content API); the uploads stay until the media library of M1.2 replaces them. Everything is under /api/v1/prototype/editor so it is
// easy to find and remove.

/** POST /prototype/editor/uploads: where the image can be fetched (a path on this site). */
export const PrototypeUploadResponse = z.object({ url: z.string().startsWith('/api/v1/prototype/editor/uploads/') })
export type PrototypeUploadResponse = z.infer<typeof PrototypeUploadResponse>

/** The name of an uploaded image: a random UUID and the extension of the type found in its bytes. */
export const PROTOTYPE_UPLOAD_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/

// TEMPORARY (removed with the prototype endpoints in the api commit of M1.1).
export const PrototypeDocument = z.object({
  id: z.uuid().nullable(),
  blocks: z.array(z.record(z.string(), z.unknown())),
  updatedAt: z.iso.datetime({ offset: true }).nullable(),
})
export type PrototypeDocument = z.infer<typeof PrototypeDocument>
export const SavePrototypeDocumentRequest = z.strictObject({ blocks: z.array(z.unknown()).max(5000) })
