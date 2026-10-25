/**
 * Focuses an element a moment from now, for a handler that is still running inside a `UForm`: the form keeps its controls disabled
 * (`loading-auto`) until the handler has returned and the page has drawn again, and a disabled field cannot take focus. `find` is
 * called then, so it finds the element that is in the page by that time.
 */
export function focusSoon(find: () => HTMLElement | null | undefined): void {
  setTimeout(() => find()?.focus(), 50)
}
