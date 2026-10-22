/**
 * After a failed check of a short form, focus goes to the first field that has an error (workflows §13). `UForm` emits
 * `@error` while the controls are still disabled, so the focus is moved after they are enabled again. An error carries the id of its
 * control when `UFormField` knows one (not always the id of the focusable element), and always the field's name.
 */
export async function focusFirstError(event: {
  errors: readonly { id?: string | undefined; name?: string | undefined }[]
}): Promise<void> {
  // `UForm` disables its controls while it validates (`loading-auto`) and enables them in the render after it has emitted this
  // event, which is queued after the first tick: one `nextTick` is too early, and the focus would fall on a disabled input.
  await nextTick()
  await nextTick()
  for (const error of event.errors) {
    const byId = error.id === undefined ? null : document.getElementById(error.id)
    const byName =
      error.name === undefined ? null : document.querySelector<HTMLElement>(`[name="${CSS.escape(error.name)}"]`)
    const target = [byId, byName].find(
      (element) =>
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement,
    )
    if (target !== undefined) {
      target.focus()
      return
    }
  }
}
