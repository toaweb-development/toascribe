<script setup lang="ts">
// «Hurtigtaster» (as Gutenberg's keyboard shortcuts dialog): the keys of the editor, by what they act on. On a Mac Ctrl is ⌘.
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()

const groups = computed(() => [
  {
    title: t('editor.shortcuts.global'),
    keys: [
      { keys: 'Ctrl+S', label: t('editor.shortcuts.save') },
      { keys: 'Ctrl+Z', label: t('editorPrototype.undo') },
      { keys: 'Ctrl+Shift+Z', label: t('editorPrototype.redo') },
    ],
  },
  {
    title: t('editor.shortcuts.blocks'),
    keys: [
      { keys: 'Ctrl+Alt+T', label: t('editor.shortcuts.insertBefore') },
      { keys: 'Ctrl+Alt+Y', label: t('editor.shortcuts.insertAfter') },
      { keys: 'Alt+Shift+↑ / ↓', label: t('editor.shortcuts.move') },
      { keys: 'Alt+Shift+Z', label: t('editorPrototype.remove') },
      { keys: 'Shift+↑ / ↓', label: t('editor.shortcuts.select') },
      { keys: t('editor.shortcuts.shiftClick'), label: t('editor.shortcuts.selectClick') },
      { keys: 'Delete', label: t('editor.shortcuts.deleteSelected') },
      { keys: '/', label: t('editor.shortcuts.slash') },
    ],
  },
  {
    title: t('editor.shortcuts.text'),
    keys: [
      { keys: 'Ctrl+B', label: t('editorPrototype.paragraph.bold') },
      { keys: 'Ctrl+I', label: t('editorPrototype.paragraph.italic') },
      { keys: 'Ctrl+E', label: t('editorPrototype.paragraph.code') },
      { keys: 'Ctrl+K', label: t('editorPrototype.paragraph.link') },
      { keys: 'Shift+Enter', label: t('editor.shortcuts.lineBreak') },
      { keys: 'Tab / Shift+Tab', label: t('editor.shortcuts.indent') },
    ],
  },
])
</script>

<template>
  <UModal :title="t('editor.shortcuts.title')" @update:open="emit('close')">
    <template #body>
      <div class="flex flex-col gap-4">
        <section v-for="group in groups" :key="group.title" class="flex flex-col gap-1">
          <h3 class="font-semibold text-highlighted">{{ group.title }}</h3>
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <template v-for="entry in group.keys" :key="entry.keys">
              <dt>
                <kbd class="rounded border border-default bg-elevated px-1.5 py-0.5 font-mono text-xs">{{
                  entry.keys
                }}</kbd>
              </dt>
              <dd class="text-default">{{ entry.label }}</dd>
            </template>
          </dl>
        </section>
      </div>
    </template>
  </UModal>
</template>
