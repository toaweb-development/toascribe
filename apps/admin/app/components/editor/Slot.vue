<script setup lang="ts">
// Where a block stands in the tree. The block's component is drawn once, into its dock (useBlockEditor); the slot moves the dock into
// itself when it is drawn. A block that moves to another parent gets a new slot there, which takes the same dock, so the component and
// its TipTap instance stay as they are (decision note 0001, adjustment 2).
const props = defineProps<{ blockId: string }>()

const editor = useBlockEditorContext()
const slot = useTemplateRef<HTMLElement>('slot')

function attach(): void {
  const element = slot.value
  if (element === null) return
  const dock = editor.dock(props.blockId)
  if (dock.parentElement !== element) element.appendChild(dock)
}
onMounted(attach)
onUpdated(attach)
</script>

<template>
  <div ref="slot" :data-slot="blockId" />
</template>
