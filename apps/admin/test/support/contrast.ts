import colors from 'tailwindcss/colors'

// WCAG 2.2 contrast of Tailwind's palette steps, for the tests that measure the admin colour schemes. Tailwind 4 writes its palette
// in oklch(), so the colour is converted to sRGB first (the OKLab matrices of Björn Ottosson, out-of-gamut values clipped).

export type Rgb = readonly [number, number, number]

const WHITE: Rgb = [1, 1, 1]

type Palette = Record<string, string | Record<string, string>>

/** A step of a Tailwind palette (`sky`, 700) as gamma-encoded sRGB, each channel 0 to 1. */
export function paletteStep(palette: string, step: number): Rgb {
  const family = (colors as unknown as Palette)[palette]
  if (typeof family !== 'object') {
    throw new Error(`no palette called ${palette}`)
  }
  const value = family[String(step)]
  if (value === undefined) {
    throw new Error(`no step ${step} in ${palette}`)
  }
  return parseOklch(value)
}

export const white = WHITE

function parseOklch(value: string): Rgb {
  const match = /^oklch\(([\d.]+)%? ([\d.]+) ([\d.]+|none)\)$/.exec(value)
  if (match === null) {
    throw new Error(`cannot read the colour ${value}`)
  }
  const lightness = Number(match[1]) / 100
  const chroma = Number(match[2])
  const hue = match[3] === 'none' ? 0 : (Number(match[3]) * Math.PI) / 180
  const a = chroma * Math.cos(hue)
  const b = chroma * Math.sin(hue)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((channel) => Math.min(1, Math.max(0, channel)))
  const encode = (channel: number) => (channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055)
  return [encode(linear[0] ?? 0), encode(linear[1] ?? 0), encode(linear[2] ?? 0)]
}

function luminance(color: Rgb): number {
  const [r, g, b] = color.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The contrast ratio of two colours, 1 to 21. */
export function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** `top` at `alpha` over `bottom`, as a browser composes them (in gamma-encoded sRGB): Nuxt UI's `bg-primary/10`. */
export function over(top: Rgb, bottom: Rgb, alpha: number): Rgb {
  return top.map((channel, index) => channel * alpha + (bottom[index] ?? 0) * (1 - alpha)) as unknown as Rgb
}
