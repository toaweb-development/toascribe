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
