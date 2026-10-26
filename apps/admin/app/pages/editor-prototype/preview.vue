<script setup lang="ts">
// PROTOTYPE (M0.6): the saved prototype draft as HTML, rendered on the server by the blocks' view components, without the editor
// and without script of its own. It shows that the stored JSON is enough to draw the page.
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t } = useI18n()
useSeoMeta({ title: () => t('editorPrototype.previewPage.title') })

const auth = useAuth()
const prototypeApi = useEditorPrototypeApi()

const mayEdit = computed(
  () => auth.session.value.status === 'authenticated' && auth.session.value.account.capabilities.includes('edit_posts'),
)
if (import.meta.server && !mayEdit.value) {
  const event = useRequestEvent()
  if (event) {
    setResponseStatus(event, 403)
  }
}
const { data, status } = await useAsyncData('editor-prototype:preview', async () =>
  mayEdit.value ? await prototypeApi.get() : null,
)
</script>

<template>
  <UDashboardPanel id="editor-prototype-preview">
    <template #header>
      <UDashboardNavbar :title="t('editorPrototype.previewPage.title')" />
    </template>
    <template #body>
      <div class="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div>
          <UButton
            to="/admin/editor-prototype"
            external
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="outline"
            :label="t('editorPrototype.previewPage.back')"
          />
        </div>
        <p class="text-sm text-muted">{{ t('editorPrototype.previewPage.intro') }}</p>
        <UAlert
          v-if="!mayEdit"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="t('editorPrototype.denied')"
        />
        <UAlert
          v-else-if="status === 'error'"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="t('editorPrototype.loadFailed')"
        />
        <p v-else-if="(data?.blocks.length ?? 0) === 0" class="text-muted">
          {{ t('editorPrototype.previewPage.empty') }}
        </p>
        <article v-else data-testid="prototype-preview" class="rounded-md border border-default p-4 sm:p-6">
          <BlocksDocument :blocks="data?.blocks ?? []" />
        </article>
      </div>
    </template>
  </UDashboardPanel>
</template>
