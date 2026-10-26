// «Rediger bilde» in the admin: the steps sent to the api, and the preview transform that must draw what sharp will make.
import { describe, expect, it } from 'vitest'

import { NO_EDIT, fittedCrop, operationsOf, previewMatrix, rectBetween, turned, turnedSize } from '../app/utils/media-edit.ts'
import type { EditState } from '../app/utils/media-edit.ts'

/** Applies an SVG matrix string to a point. */
function apply(matrix: string, x: number, y: number): [number, number] {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = (/matrix\(([^)]*)\)/.exec(matrix)?.[1] ?? '').split(' ').map(Number)
  return [a * x + c * y + e, b * x + d * y + f]
}

describe('the edit steps', () => {
  it('sends nothing for no change, and turn, mirror, crop and scale in that order', () => {
    expect(operationsOf(800, 600, NO_EDIT)).toEqual([])
    const state: EditState = {
      turn: 90,
      flipHorizontal: true,
      flipVertical: false,
      crop: { x: 10, y: 20, width: 300, height: 400 },
      scaleWidth: 150,
    }
    expect(operationsOf(800, 600, state)).toEqual([
      { op: 'rotate', degrees: 90 },
      { op: 'flip', direction: 'horizontal' },
      { op: 'crop', x: 10, y: 20, width: 300, height: 400 },
      { op: 'scale', width: 150 },
    ])
  })

  it('leaves out a crop of the whole image and a scale that would not make it smaller', () => {
    const state: EditState = { ...NO_EDIT, crop: { x: 0, y: 0, width: 800, height: 600 }, scaleWidth: 800 }
    expect(operationsOf(800, 600, state)).toEqual([])
  })

  it('turns both ways round, and drops the crop on a turn', () => {
    const cropped: EditState = { ...NO_EDIT, crop: { x: 1, y: 1, width: 5, height: 5 } }
    expect(turned(cropped, 1)).toMatchObject({ turn: 90, crop: null })
    expect(turned(NO_EDIT, -1).turn).toBe(270)
    expect(turned(turned(NO_EDIT, -1), 1).turn).toBe(0)
    expect(turnedSize(800, 600, 270)).toEqual({ width: 600, height: 800 })
  })
})

describe('the preview transform', () => {
  // The image's top-left corner (0, 0) and top-right corner (w, 0), 800 × 600.
  it('turns clockwise as sharp does', () => {
    expect(apply(previewMatrix(800, 600, { ...NO_EDIT, turn: 90 }), 0, 0)).toEqual([600, 0])
    expect(apply(previewMatrix(800, 600, { ...NO_EDIT, turn: 90 }), 800, 0)).toEqual([600, 800])
    expect(apply(previewMatrix(800, 600, { ...NO_EDIT, turn: 180 }), 0, 0)).toEqual([800, 600])
    expect(apply(previewMatrix(800, 600, { ...NO_EDIT, turn: 270 }), 0, 0)).toEqual([0, 800])
  })

  it('mirrors in the turned image', () => {
    expect(apply(previewMatrix(800, 600, { ...NO_EDIT, flipHorizontal: true }), 0, 0)).toEqual([800, 0])
    expect(apply(previewMatrix(800, 600, { ...NO_EDIT, flipVertical: true }), 0, 0)).toEqual([0, 600])
    // Turned to 600 × 800, then mirrored left to right: the top-left corner lands at (0, 0).
    expect(apply(previewMatrix(800, 600, { ...NO_EDIT, turn: 90, flipHorizontal: true }), 0, 0)).toEqual([0, 0])
  })
})

describe('the crop', () => {
  const bounds = { width: 800, height: 600 }
  it('is the rectangle between two points, either way, kept inside the image', () => {
    expect(rectBetween({ x: 500, y: 400 }, { x: 100.4, y: -20 }, bounds)).toEqual({ x: 100, y: 0, width: 400, height: 400 })
    expect(rectBetween({ x: 700, y: 500 }, { x: 900, y: 700 }, bounds)).toEqual({ x: 700, y: 500, width: 100, height: 100 })
  })

  it('fits typed numbers into the image, and has none without an area', () => {
    expect(fittedCrop({ x: 700, y: 0, width: 300, height: 100 }, bounds)).toEqual({ x: 700, y: 0, width: 100, height: 100 })
    expect(fittedCrop({ x: 10, y: 10, width: 0, height: 100 }, bounds)).toBeNull()
  })
})
