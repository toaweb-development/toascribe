/**
 * Warns before unsaved edits are lost (workflows §14): a reload or closing the tab (the browser's own question), and leaving the
 * page inside the admin (a confirmation dialog that names what is lost). `dirty` is read at the moment of leaving. Call it in the
 * setup of the page.
 */
export function useUnsavedGuard(dirty: () => boolean) {
  const { t } = useI18n()
  const { ask } = useConfirmDialog()

  onBeforeRouteLeave(async () => {
    if (!dirty()) {
      return true
    }
    return ask({
      title: t('profile.unsaved.title'),
      description: t('profile.unsaved.text'),
      confirmLabel: t('profile.unsaved.leave'),
      cancelLabel: t('profile.unsaved.stay'),
      color: 'error',
    })
  })

  function warn(event: BeforeUnloadEvent): void {
    if (dirty()) {
      event.preventDefault()
    }
  }
  onMounted(() => window.addEventListener('beforeunload', warn))
  onBeforeUnmount(() => window.removeEventListener('beforeunload', warn))
}
