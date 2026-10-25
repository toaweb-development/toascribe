/**
 * Resolves when an overlay (useOverlay) is gone from the page, not when it was asked to close. A dialog traps focus until its leave
 * animation ends, so a field the page wants to focus after the dialog must wait for that: focus moved earlier is pulled back, and
 * Reka returns focus to the opener only at the end too. Call it in setup; it returns a function that takes the overlay's id.
 */
export function useOverlayClosed() {
  const { overlays } = useOverlay()

  return (id: symbol): Promise<void> =>
    new Promise((resolve) => {
      const stop = watch(
        () => overlays.find((overlay) => overlay.id === id)?.isMounted ?? false,
        (mounted) => {
          if (!mounted) {
            stop()
            resolve()
          }
        },
        { immediate: true },
      )
    })
}
