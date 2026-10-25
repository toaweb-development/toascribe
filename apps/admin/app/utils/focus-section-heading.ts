/**
 * Puts focus on the heading of a profile section (components/profile/Section.vue gives it the id `<section>-heading` and
 * `tabindex="-1"`). Used when the control that had focus is gone (a removed row, a closed form): workflows §17, accessibility §6.
 * Two ticks, because a `UForm` enables its controls only after the render that follows its handler.
 */
export async function focusSectionHeading(sectionId: string): Promise<void> {
  await nextTick()
  await nextTick()
  document.getElementById(`${sectionId}-heading`)?.focus()
}
