// What an upload is, from its bytes (K-125: «Typen sjekkes ut fra innholdet, ikke filendelsen»). The extension says what the person
// claims; the content must agree: a PNG named .jpg, an HTML page named .txt and an SVG are refused.
import { fileTypeFromBuffer } from 'file-type'

import { MEDIA_TYPES, extensionOf } from './types.ts'
import type { MediaGroup } from '@toascribe/shared'

export type DetectionFailure =
  /** The extension is not on the list (or the role may not upload that group). */
  | 'unsupported_type'
  /** The content is not what the extension says. */
  | 'type_mismatch'
  | 'empty_file'

export type Detection =
  | { readonly ok: true; readonly ext: string; readonly mime: string; readonly group: MediaGroup }
  | { readonly ok: false; readonly reason: DetectionFailure }

/** How many bytes of a text file are looked at for binary content. Enough to catch a binary renamed .txt. */
const TEXT_SAMPLE = 64 * 1024

/** True for UTF-8 text without NUL or other control bytes than tab, line feed, form feed and carriage return. */
export function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, TEXT_SAMPLE)
  for (const byte of sample) {
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20) || byte === 0x7f) {
      return false
    }
  }
  try {
    // A sample may cut a character at its end; decode one character short of the end when the sample is not the whole file.
    const end = sample.length < bytes.length ? Math.max(0, sample.length - 4) : sample.length
    new TextDecoder('utf-8', { fatal: true }).decode(sample.subarray(0, end))
    return true
  } catch {
    return false
  }
}

/** Markup that makes a «text» file a page in a browser that sniffs it, even served as an attachment with nosniff. */
const MARKUP = /<\s*(script|html|svg|iframe|object|embed|body|head|meta)\b/i

/**
 * The type of an upload: the extension of `fileName` must be on the list (and in `allowedGroups` when given), and the content must
 * have one of the signatures that extension allows, or, for a text type, be text without markup.
 */
export async function detectType(
  bytes: Uint8Array,
  fileName: string,
  allowedGroups?: readonly MediaGroup[],
): Promise<Detection> {
  if (bytes.length === 0) {
    return { ok: false, reason: 'empty_file' }
  }
  const ext = extensionOf(fileName)
  const entry = MEDIA_TYPES[ext]
  if (entry === undefined || (allowedGroups !== undefined && !allowedGroups.includes(entry.group))) {
    return { ok: false, reason: 'unsupported_type' }
  }
  const found = await fileTypeFromBuffer(bytes)
  if (entry.signatures.length === 0) {
    // Text: no binary signature may be found, and the bytes must be text without markup.
    const text = found === undefined && looksLikeText(bytes)
    if (!text || MARKUP.test(new TextDecoder().decode(bytes.subarray(0, TEXT_SAMPLE)))) {
      return { ok: false, reason: 'type_mismatch' }
    }
    return { ok: true, ext, mime: entry.mime, group: entry.group }
  }
  if (found === undefined || !entry.signatures.includes(found.ext)) {
    return { ok: false, reason: 'type_mismatch' }
  }
  return { ok: true, ext, mime: entry.mime, group: entry.group }
}

/** The extension the content shows, when it is one of the library's types (for a file fetched from an address without one). */
export async function contentExtension(bytes: Uint8Array): Promise<string | undefined> {
  const found = await fileTypeFromBuffer(bytes)
  if (found === undefined) {
    return undefined
  }
  const ext = found.ext === 'jpg' ? 'jpg' : found.ext === 'tif' ? 'tif' : found.ext
  return MEDIA_TYPES[ext] === undefined ? undefined : ext
}
