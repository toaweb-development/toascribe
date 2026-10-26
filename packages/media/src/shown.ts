import { WEB_IMAGE_MIMES } from './types.ts'

// Which file of an upload is «the image as it is shown» (M1.2): the edited image, else WordPress' `-scaled` copy, else the original when a
// browser shows it as it is, else the largest generated size (a TIFF is shown through its WebP sizes). The api serves it as the file's
// address and checks an edit's steps against its pixels; the worker applies the steps to the same file. One rule, so the crop the
// person drew is the crop that is made.

export interface ShownFile {
  readonly key: string
  readonly width: number | null
  readonly height: number | null
  readonly mime: string
}

interface Generated {
  readonly key: string
  readonly width: number
  readonly height: number
  readonly mime: string
}

export function shownFile(
  original: ShownFile,
  variants: {
    readonly sizes: Readonly<Record<string, Generated>>
    readonly scaled?: Generated | undefined
    readonly edited?: Generated | undefined
  },
): ShownFile {
  if (variants.edited !== undefined) return variants.edited
  if (variants.scaled !== undefined) return variants.scaled
  if (WEB_IMAGE_MIMES.has(original.mime) || !original.mime.startsWith('image/')) return original
  const largest = Object.values(variants.sizes).sort((a, b) => b.width - a.width)[0]
  return largest ?? original
}
