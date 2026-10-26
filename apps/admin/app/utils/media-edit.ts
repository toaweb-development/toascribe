import type { MediaEditOperation } from '@toascribe/shared'

// «Rediger bilde» (K-114) as state: a turn, the mirrorings, a crop and a scale, kept in that order, so the preview can draw them with
// one SVG transform and the crop is drawn on the turned image. The api applies the steps in the same order to the image as it is shown.

export type Turn = 0 | 90 | 180 | 270

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface EditState {
  readonly turn: Turn
  readonly flipHorizontal: boolean
  readonly flipVertical: boolean
  /** In the pixels of the turned image; null for no crop. */
  readonly crop: Rect | null
  /** The new width of the result; null to keep it. */
  readonly scaleWidth: number | null
}

export const NO_EDIT: EditState = { turn: 0, flipHorizontal: false, flipVertical: false, crop: null, scaleWidth: null }

/** The size of the image after the turn. */
export function turnedSize(width: number, height: number, turn: Turn): { width: number; height: number } {
  return turn === 90 || turn === 270 ? { width: height, height: width } : { width, height }
}

/** A quarter turn to the right (`1`) or the left (`-1`). A turn moves the crop, so the crop is dropped. */
export function turned(state: EditState, direction: 1 | -1): EditState {
  const next = (((state.turn + direction * 90) % 360) + 360) % 360
  return { ...state, turn: next as Turn, crop: null, scaleWidth: null }
}

/**
 * The SVG transform that draws the image (in its own pixels, `width` × `height`) turned clockwise and mirrored, inside a viewBox of
 * the turned size: `matrix(a b c d e f)`, which maps (x, y) to (a·x + c·y + e, b·x + d·y + f).
 */
export function previewMatrix(width: number, height: number, state: EditState): string {
  // The turn, clockwise as sharp's rotate.
  let [a, b, c, d, e, f] =
    state.turn === 90
      ? [0, 1, -1, 0, height, 0]
      : state.turn === 180
        ? [-1, 0, 0, -1, width, height]
        : state.turn === 270
          ? [0, -1, 1, 0, 0, width]
          : [1, 0, 0, 1, 0, 0]
  const size = turnedSize(width, height, state.turn)
  // Then the mirrorings, in the turned image: x → W - x, y → H - y.
  if (state.flipHorizontal) {
    ;[a, c, e] = [-a, -c, size.width - e]
  }
  if (state.flipVertical) {
    ;[b, d, f] = [-b, -d, size.height - f]
  }
  return `matrix(${[a, b, c, d, e, f].map((n) => String(n === 0 ? 0 : n)).join(' ')})`
}

/** The rectangle between two points, in whole pixels, inside the image. */
export function rectBetween(
  from: { x: number; y: number },
  to: { x: number; y: number },
  bounds: { width: number; height: number },
): Rect {
  const clamp = (value: number, max: number) => Math.min(Math.max(Math.round(value), 0), max)
  const x1 = clamp(Math.min(from.x, to.x), bounds.width)
  const y1 = clamp(Math.min(from.y, to.y), bounds.height)
  const x2 = clamp(Math.max(from.x, to.x), bounds.width)
  const y2 = clamp(Math.max(from.y, to.y), bounds.height)
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

/** A crop typed into the fields, kept inside the image; null when it has no area. */
export function fittedCrop(rect: Rect, bounds: { width: number; height: number }): Rect | null {
  const x = Math.min(Math.max(Math.round(rect.x), 0), bounds.width - 1)
  const y = Math.min(Math.max(Math.round(rect.y), 0), bounds.height - 1)
  const width = Math.min(Math.max(Math.round(rect.width), 0), bounds.width - x)
  const height = Math.min(Math.max(Math.round(rect.height), 0), bounds.height - y)
  return width >= 1 && height >= 1 ? { x, y, width, height } : null
}

/** The size of the result before the scale: the crop, or the turned image. */
export function croppedSize(width: number, height: number, state: EditState): { width: number; height: number } {
  return state.crop === null
    ? turnedSize(width, height, state.turn)
    : { width: state.crop.width, height: state.crop.height }
}

/** The steps for the api, in the order the preview draws them. Empty when nothing changes. */
export function operationsOf(width: number, height: number, state: EditState): MediaEditOperation[] {
  const steps: MediaEditOperation[] = []
  if (state.turn !== 0) steps.push({ op: 'rotate', degrees: state.turn })
  if (state.flipHorizontal) steps.push({ op: 'flip', direction: 'horizontal' })
  if (state.flipVertical) steps.push({ op: 'flip', direction: 'vertical' })
  const whole = turnedSize(width, height, state.turn)
  const crop = state.crop
  if (crop !== null && (crop.x !== 0 || crop.y !== 0 || crop.width !== whole.width || crop.height !== whole.height)) {
    steps.push({ op: 'crop', ...crop })
  }
  const before = croppedSize(width, height, state)
  if (state.scaleWidth !== null && state.scaleWidth >= 1 && state.scaleWidth < before.width) {
    steps.push({ op: 'scale', width: Math.round(state.scaleWidth) })
  }
  return steps
}
