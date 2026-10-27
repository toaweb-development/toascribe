<script setup lang="ts">
import { SEO_DESCRIPTION_MAX_LENGTH, SEO_TITLE_MAX_LENGTH } from '@toascribe/shared'

// The SEO panel (K-105): the title and the description a search engine and a share show, the sharing image, and «skjul fra søk»
// (noindex). An empty field falls back to the item's title, its excerpt and its featured image, as the previews show. Google cuts a
// title at about 60 characters and a description at about 155: the counters say so, they do not stop the typing.
const props = defineProps<{ title: string; excerpt: string; path: string; featuredMediaId: string | null }>()
const seo = defineModel<{ title: string; description: string; image: string | null; noindex: boolean }>({
  required: true,
})

const { t } = useI18n()
const uid = useId()
const mediaRefs = useMediaRefs()

const shownTitle = computed(() => seo.value.title.trim() || props.title.trim() || t('content.noTitle'))
const shownDescription = computed(() => seo.value.description.trim() || props.excerpt.trim())
const shownImage = computed(() => {
  const id = seo.value.image ?? props.featuredMediaId
  return id === null ? undefined : mediaRefs.value.get(id)
})
// The address the site answers on, the same on the server and in the browser (no hydration mismatch).
const host = useRequestURL().host
const SEARCH_TITLE = 60
const SEARCH_DESCRIPTION = 155
</script>

<template>
  <div class="flex flex-col gap-3">
    <UFormField
      :label="t('editor.seo.title')"
      :name="`${uid}-seo-title`"
      :hint="`${String(seo.title.length)} / ${String(SEARCH_TITLE)}`"
    >
      <UInput v-model="seo.title" class="w-full" :maxlength="SEO_TITLE_MAX_LENGTH" :placeholder="title" />
    </UFormField>
    <UFormField
      :label="t('editor.seo.description')"
      :name="`${uid}-seo-description`"
      :hint="`${String(seo.description.length)} / ${String(SEARCH_DESCRIPTION)}`"
    >
      <UTextarea v-model="seo.description" :rows="3" class="w-full" :maxlength="SEO_DESCRIPTION_MAX_LENGTH" />
    </UFormField>
    <ContentFeaturedImage v-model="seo.image" :label="t('editor.seo.image')" :help="t('editor.seo.imageHelp')" />
    <USwitch v-model="seo.noindex" :label="t('editor.seo.noindex')" />

    <section :aria-labelledby="`${uid}-search`" class="flex flex-col gap-1">
      <h4 :id="`${uid}-search`" class="text-xs font-semibold text-muted uppercase">
        {{ t('editor.seo.searchPreview') }}
      </h4>
      <div class="rounded-md border border-default p-3">
        <p class="truncate text-xs text-toned">{{ host }}{{ path }}</p>
        <p class="line-clamp-1 text-base text-primary">{{ shownTitle }}</p>
        <p class="line-clamp-2 text-sm text-toned">{{ shownDescription || t('editor.seo.noDescription') }}</p>
      </div>
    </section>
    <section :aria-labelledby="`${uid}-share`" class="flex flex-col gap-1">
      <h4 :id="`${uid}-share`" class="text-xs font-semibold text-muted uppercase">
        {{ t('editor.seo.sharePreview') }}
      </h4>
      <div class="overflow-hidden rounded-md border border-default">
        <!-- eslint-disable vue/html-self-closing -->
        <img v-if="shownImage" :src="shownImage.url" alt="" class="aspect-[1.91/1] w-full object-cover" />
        <!-- eslint-enable vue/html-self-closing -->
        <div class="flex flex-col gap-0.5 bg-elevated p-3">
          <p class="truncate text-xs text-toned uppercase">{{ host }}</p>
          <p class="line-clamp-2 font-semibold text-highlighted">{{ shownTitle }}</p>
          <p class="line-clamp-2 text-sm text-toned">{{ shownDescription }}</p>
        </div>
      </div>
    </section>
  </div>
</template>
