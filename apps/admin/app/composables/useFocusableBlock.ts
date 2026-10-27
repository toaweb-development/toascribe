/**
 * A block without text that still takes the focus (a separator, a spacer, «Les mer», a page break): its element is registered as the
 * block's focus target, and focusing it selects the block, so its toolbar shows and the keys to move and delete it work.
 */
export function useFocusableBlock(id: () => string) {
  const editor = useBlockEditorContext()
  const element = shallowRef<HTMLElement | null>(null)
  const handler = { focus: () => element.value?.focus() }
  onMounted(() => editor.registerFocus(id(), handler))
  onBeforeUnmount(() => editor.unregisterFocus(id(), handler))
  return {
    ref: (value: unknown) => {
      element.value = value instanceof HTMLElement ? value : null
    },
    onFocus: () => editor.select({ blockId: id() }),
  }
}
