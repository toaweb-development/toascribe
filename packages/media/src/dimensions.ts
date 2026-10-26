// An image's width and height read from its header, without decoding it (K-125): the pixel limit is checked on these numbers before
// anything decodes the image, so a small file that claims to be 50 000 × 50 000 pixels is refused before it can take the memory.
import { imageSize } from 'image-size'

export interface Dimensions {
  readonly width: number
  readonly height: number
}

/** The dimensions from the header, or undefined when the header cannot be read. EXIF orientation is not applied here. */
export function headerDimensions(bytes: Uint8Array): Dimensions | undefined {
  try {
    const size = imageSize(bytes)
    const width = size.width
    const height = size.height
    if (width <= 0 || height <= 0) {
      return undefined
    }
    // An image with several frames or sizes (ICO, animated): the largest one counts.
    const images = size.images ?? []
    return images.reduce<Dimensions>(
      (largest, image) => (image.width * image.height > largest.width * largest.height ? image : largest),
      { width, height },
    )
  } catch {
    return undefined
  }
}
