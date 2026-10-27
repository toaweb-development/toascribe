// What the editor takes from the site's active theme (M1.4, Tor's decision): the heading levels it offers and the page templates per
// type. The site answers at `/_toascribe/theme`; without an answer (the site is down, or built without a theme) the editor offers
// H2 to H6 and no templates of the theme.
import type { ActiveTheme, ContentTypeKey } from '@toascribe/shared'

/** The levels when the theme does not say: H1 is the title. */
export const FALLBACK_HEADING_LEVELS: readonly number[] = [2, 3, 4, 5, 6]

/** The levels to offer for a heading: the theme's, and the one the heading has (a stored H1 keeps it). */
export function headingLevelsFor(theme: ActiveTheme | null, current: number): number[] {
  const levels = new Set(theme?.headingLevels ?? FALLBACK_HEADING_LEVELS)
  levels.add(current)
  return [...levels].sort((a, b) => a - b)
}

/**
 * The template choices of an item: the default, the theme's templates for its type, and the one it has when the theme no longer
 * offers it (shown by its slug, so it is not lost by opening the item).
 */
export function templateItemsFor(
  theme: ActiveTheme | null,
  type: ContentTypeKey,
  current: string | null,
  defaultItem: { value: string; label: string },
): { value: string; label: string }[] {
  const offered = (theme?.templates ?? []).filter((template) => template.types.includes(type))
  const items = [defaultItem, ...offered.map((template) => ({ value: template.slug, label: template.name }))]
  if (current !== null && current !== defaultItem.value && !items.some((item) => item.value === current)) {
    items.push({ value: current, label: current })
  }
  return items
}
