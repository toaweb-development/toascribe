<script setup lang="ts">
import type { ContentAuthorRef, ContentItem, ContentTypeKey, TermItem } from '@toascribe/shared'

import type { EditorForm, FormRights } from '~/utils/editor-form'

// The «Innlegg» / «Side» tab of the sidebar (PLAN «Redigeringsskjermen», WordPress' document settings): status and visibility, the
// publish time («Umiddelbart» or a chosen time; a time ahead schedules, K-063) and the time it goes back to draft (K-064), authors
// (K-066), «Fest øverst» and categories and tags for a post, the featured image (K-070), the excerpt (K-107), discussion, the page
// attributes for a page, the SEO panel (K-105) and «Flytt til papirkurven». What the account may not change is not offered: authors
// need editOthers, «Fest øverst» needs editOthers and publish, private needs publish.
const props = defineProps<{
  type: ContentTypeKey
  item: ContentItem | null
  rights: FormRights
  authors: readonly ContentAuthorRef[]
  parents: readonly { id: string; label: string }[]
  categories: readonly TermItem[]
  /** The address of the item on the site, for the SEO preview. */
  path: string
  readOnly: boolean
}>()
const form = defineModel<EditorForm>({ required: true })
const emit = defineEmits<{ trash: [] }>()

const { t } = useI18n()
const uid = useId()
const NO_PARENT = 'none'
const DEFAULT_TEMPLATE = 'default'

const isPost = computed(() => props.type === 'post')
const statusText = computed(() =>
  props.item === null || props.item.status === 'trash' ? t('content.status.draft') : statusLabel(t, props.item.status),
)
const visibilityItems = computed(() => [
  { value: 'public', label: t('editor.document.public'), description: t('editor.document.publicHelp') },
  ...(props.rights.publish
    ? [{ value: 'private', label: t('editor.document.private'), description: t('editor.document.privateHelp') }]
    : []),
  { value: 'password', label: t('editor.document.password'), description: t('editor.document.passwordHelp') },
])
const scheduled = computed({
  get: () => form.value.publishAt !== '',
  set: (on: boolean) => {
    form.value.publishAt = on ? toLocalInput(new Date(Date.now() + 60 * 60 * 1000).toISOString()) : ''
  },
})
const authorItems = computed(() => props.authors.map((entry) => ({ value: entry.id, label: entry.displayName })))
const parentItems = computed(() => [
  { value: NO_PARENT, label: t('content.quickEdit.noParent') },
  ...props.parents.map((entry) => ({ value: entry.id, label: entry.label })),
])
const parent = computed({
  get: () => form.value.parentId ?? NO_PARENT,
  set: (value: string) => {
    form.value.parentId = value === NO_PARENT ? null : value
  },
})
const activeTheme = useActiveTheme()
const templateItems = computed(() =>
  templateItemsFor(activeTheme.value, props.type, form.value.template ?? null, {
    value: DEFAULT_TEMPLATE,
    label: t('content.quickEdit.defaultTemplate'),
  }),
)
const template = computed({
  get: () => form.value.template ?? DEFAULT_TEMPLATE,
  set: (value: string) => {
    form.value.template = value === DEFAULT_TEMPLATE ? null : value
  },
})
</script>

<template>
  <fieldset :disabled="readOnly" class="flex flex-col gap-5">
    <section :aria-labelledby="`${uid}-summary`" class="flex flex-col gap-3">
      <h3 :id="`${uid}-summary`" class="font-semibold text-highlighted">{{ t('editor.document.summary') }}</h3>
      <p class="text-sm text-toned">{{ t('content.editor.status', { status: statusText }) }}</p>
      <URadioGroup v-model="form.visibility" :legend="t('editor.document.visibility')" :items="visibilityItems" />
      <UFormField
        v-if="form.visibility === 'password'"
        :label="t('editor.document.passwordField')"
        :help="item?.visibility === 'password' ? t('editor.document.passwordKeep') : undefined"
        :name="`${uid}-password`"
      >
        <UInput v-model="form.password" type="password" autocomplete="new-password" class="w-full" maxlength="255" />
      </UFormField>

      <USwitch v-if="rights.publish" v-model="scheduled" :label="t('editor.document.chooseTime')" />
      <p v-if="rights.publish && !scheduled" class="text-sm text-toned">{{ t('editor.document.immediately') }}</p>
      <UFormField v-if="rights.publish && scheduled" :label="t('editor.document.publishAt')" :name="`${uid}-publish`">
        <UInput v-model="form.publishAt" type="datetime-local" class="w-full" />
      </UFormField>
      <UFormField
        v-if="rights.publish"
        :label="t('editor.document.unpublishAt')"
        :help="t('editor.document.unpublishHelp')"
        :name="`${uid}-unpublish`"
      >
        <UInput v-model="form.unpublishAt" type="datetime-local" class="w-full" />
      </UFormField>

      <UFormField :label="t('content.quickEdit.slug')" :name="`${uid}-slug`">
        <UInput v-model="form.slug" class="w-full" maxlength="200" />
      </UFormField>

      <UFormField
        v-if="rights.editOthers && authorItems.length > 0"
        :label="t('editor.document.authors')"
        :name="`${uid}-authors`"
      >
        <USelectMenu v-model="form.authors" :items="authorItems" value-key="value" multiple class="w-full" />
      </UFormField>

      <USwitch
        v-if="isPost && rights.editOthers && rights.publish"
        v-model="form.sticky"
        :label="t('content.quickEdit.sticky')"
      />
      <USwitch v-model="form.commentsOpen" :label="t('editor.document.comments')" />
    </section>

    <section v-if="isPost" :aria-labelledby="`${uid}-terms`" class="flex flex-col gap-3">
      <h3 :id="`${uid}-terms`" class="font-semibold text-highlighted">{{ t('editor.document.terms') }}</h3>
      <ContentCategoryTree v-model="form.categories" :terms="categories" :legend="t('editor.document.categories')" />
      <UFormField :label="t('editor.document.tags')" :help="t('editor.document.tagsHelp')" :name="`${uid}-tags`">
        <UInput v-model="form.tags" class="w-full" />
      </UFormField>
    </section>

    <section :aria-labelledby="`${uid}-featured`" class="flex flex-col gap-3">
      <h3 :id="`${uid}-featured`" class="font-semibold text-highlighted">{{ t('editor.featured.title') }}</h3>
      <ContentFeaturedImage v-model="form.featuredMediaId" :label="t('editor.featured.title')" />
    </section>

    <section :aria-labelledby="`${uid}-excerpt`" class="flex flex-col gap-2">
      <h3 :id="`${uid}-excerpt`" class="font-semibold text-highlighted">{{ t('editor.document.excerpt') }}</h3>
      <UFormField
        :label="t('editor.document.excerpt')"
        :help="t('editor.document.excerptHelp')"
        :name="`${uid}-excerpt-text`"
      >
        <UTextarea v-model="form.excerpt" :rows="3" class="w-full" maxlength="2000" />
      </UFormField>
    </section>

    <section v-if="!isPost" :aria-labelledby="`${uid}-page`" class="flex flex-col gap-3">
      <h3 :id="`${uid}-page`" class="font-semibold text-highlighted">{{ t('editor.document.pageAttributes') }}</h3>
      <UFormField :label="t('content.quickEdit.parent')" :name="`${uid}-parent`">
        <USelect v-model="parent" :items="parentItems" class="w-full" />
      </UFormField>
      <UFormField :label="t('content.quickEdit.template')" :name="`${uid}-template`">
        <USelect v-model="template" :items="templateItems" class="w-full" />
      </UFormField>
      <UFormField :label="t('content.quickEdit.order')" :name="`${uid}-order`">
        <UInputNumber v-model="form.menuOrder" :min="-1000000" :max="1000000" class="w-full" />
      </UFormField>
    </section>

    <section :aria-labelledby="`${uid}-seo`" class="flex flex-col gap-3">
      <h3 :id="`${uid}-seo`" class="font-semibold text-highlighted">{{ t('editor.seo.heading') }}</h3>
      <ContentSeoPanel
        v-model="form.seo"
        :title="form.title"
        :excerpt="form.excerpt"
        :path="path"
        :featured-media-id="form.featuredMediaId"
      />
    </section>

    <UButton
      v-if="item && item.can.delete && item.status !== 'trash'"
      icon="i-lucide-trash-2"
      color="error"
      variant="outline"
      class="min-h-11 self-start"
      :label="t('editor.document.trash')"
      @click="emit('trash')"
    />
  </fieldset>
</template>
