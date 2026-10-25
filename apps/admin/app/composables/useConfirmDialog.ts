import { ProfileConfirmModal } from '#components'

export interface ConfirmQuestion {
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
  color?: 'primary' | 'error'
}

/** A confirmation dialog (components/profile/ConfirmModal.vue): `await ask({...})` is true when the person confirmed. Call it in setup. */
export function useConfirmDialog() {
  const overlay = useOverlay()
  const dialog = overlay.create(ProfileConfirmModal)
  const closed = useOverlayClosed()

  async function ask(question: ConfirmQuestion): Promise<boolean> {
    const confirmed = (await dialog.open(question)) === true
    // The caller moves focus next: it can only do that once the dialog has left.
    await closed(dialog.id)
    return confirmed
  }

  return { ask }
}
