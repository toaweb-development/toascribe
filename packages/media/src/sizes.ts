// The sizes WordPress makes of an image (wp_create_image_subsizes, image_resize_dimensions): every size is a box of at most width ×
// height (0 = no limit on that side), nothing is ever scaled up, and a cropped size (thumbnail) is cut to its box from the middle. An
// original larger than 2560 on either side also gets a `-scaled` copy (WordPress' big_image_size_threshold); the sizes are cut from the
// original, as WordPress does, for the best quality.

export interface SizeSetting {
  readonly name: string
  readonly width: number
  readonly height: number
  readonly crop: boolean
}

export interface PlannedSize {
  readonly name: string
  readonly width: number
  readonly height: number
  readonly crop: boolean
}

/** WordPress' big_image_size_threshold. */
export const BIG_IMAGE_THRESHOLD = 2560

/** The default sizes, with the three that «Innstillinger → Media» controls taken from the settings. */
export function defaultSizes(settings: {
  readonly thumbnail_size_w: number
  readonly thumbnail_size_h: number
  readonly thumbnail_crop: boolean
  readonly medium_size_w: number
  readonly medium_size_h: number
  readonly large_size_w: number
  readonly large_size_h: number
}): SizeSetting[] {
  return [
    {
      name: 'thumbnail',
      width: settings.thumbnail_size_w,
      height: settings.thumbnail_size_h,
      crop: settings.thumbnail_crop,
    },
    { name: 'medium', width: settings.medium_size_w, height: settings.medium_size_h, crop: false },
    { name: 'medium_large', width: 768, height: 0, crop: false },
    { name: 'large', width: settings.large_size_w, height: settings.large_size_h, crop: false },
    { name: '1536x1536', width: 1536, height: 1536, crop: false },
    { name: '2048x2048', width: 2048, height: 2048, crop: false },
  ]
}

/**
 * WordPress' image_resize_dimensions(): the size of one sub-size of a `width` × `height` image, or undefined when it would not be
 * smaller (no upscaling) or the size is switched off (0 × 0).
 */
export function resizeDimensions(width: number, height: number, size: SizeSetting): PlannedSize | undefined {
  const maxW = size.width
  const maxH = size.height
  if (maxW <= 0 && maxH <= 0) {
    return undefined
  }
  if (size.crop) {
    // The box, but never larger than the image on either side.
    const w = Math.min(maxW > 0 ? maxW : width, width)
    const h = Math.min(maxH > 0 ? maxH : height, height)
    if (w >= width && h >= height) {
      return undefined
    }
    return { name: size.name, width: w, height: h, crop: true }
  }
  const scale = Math.min(maxW > 0 ? maxW / width : Infinity, maxH > 0 ? maxH / height : Infinity)
  if (scale >= 1) {
    return undefined
  }
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  return { name: size.name, width: w, height: h, crop: false }
}

/** The sizes to make of an image, and the `-scaled` size when it is larger than the threshold. */
export function planSizes(
  width: number,
  height: number,
  sizes: readonly SizeSetting[],
): { sizes: PlannedSize[]; scaled: PlannedSize | undefined } {
  const planned = sizes.flatMap((size) => {
    const result = resizeDimensions(width, height, size)
    return result === undefined ? [] : [result]
  })
  const scaled =
    width > BIG_IMAGE_THRESHOLD || height > BIG_IMAGE_THRESHOLD
      ? resizeDimensions(width, height, {
          name: 'scaled',
          width: BIG_IMAGE_THRESHOLD,
          height: BIG_IMAGE_THRESHOLD,
          crop: false,
        })
      : undefined
  return { sizes: planned, scaled }
}
