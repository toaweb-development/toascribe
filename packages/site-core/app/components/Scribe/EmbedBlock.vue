<script setup lang="ts">
// The site's view of «Innbygging» (M1.6, K-225). The player is drawn only when its address passes the provider's check again
// (shared/oembed.ts: its own hosts, its player's shape), and with «Klikk for å laste» on (the default, «Personvern») only after the
// reader asks: until then the page loads nothing from the provider, and shows the thumbnail stored in the media library, the
// service's name and a link to the content (which also works without JavaScript). Anything else is the core view's link card.
import type { Block } from '@toascribe/blocks'
import type { ViewContext } from '@toascribe/block-views'
import { EMBED_PROVIDER_NAMES, EmbedProvider, isEmbedFrame, isSafeEmbedLink } from '@toascribe/shared'

const props = defineProps<{ block: Block; context: ViewContext }>()
const { t } = useI18n()
const settings = useSettings()

const text = (key: string) => {
  const value = props.block.attrs[key]
  return typeof value === 'string' ? value : ''
}
const url = computed(() => text('url'))
const provider = computed(() => {
  const parsed = EmbedProvider.safeParse(text('provider'))
  return parsed.success ? parsed.data : undefined
})
const service = computed(() => (provider.value === undefined ? '' : EMBED_PROVIDER_NAMES[provider.value]))
const frame = computed(() => {
  const src = text('frameSrc')
  return provider.value !== undefined && isEmbedFrame(provider.value, src, url.value) ? src : undefined
})
const title = computed(() => text('title') || service.value)
const thumbnail = computed(() => props.context.media.get(text('thumbnailId')))
const caption = computed(() => text('caption'))
const size = (key: string) => {
  const value = props.block.attrs[key]
  return typeof value === 'number' && value > 0 ? value : undefined
}
// Players that are a strip (a song, a post) and those that keep a picture's shape.
const kind = computed(() =>
  provider.value === 'spotify' || provider.value === 'soundcloud'
    ? 'is-audio'
    : provider.value === 'bluesky' || provider.value === 'mastodon'
      ? 'is-post'
      : provider.value === 'tiktok'
        ? 'is-portrait'
        : 'is-video',
)
const loaded = ref(settings.value?.embed.clickToLoad === false)
</script>

<template>
  <figure
    v-if="frame && isSafeEmbedLink(url)"
    class="block-embed scribe-embed"
    :class="[`is-provider-${provider}`, kind, { 'is-loaded': loaded }]"
  >
    <iframe
      v-if="loaded"
      :src="frame"
      :title="title"
      :width="size('width')"
      :height="size('height')"
      loading="lazy"
      referrerpolicy="strict-origin-when-cross-origin"
      allow="encrypted-media; picture-in-picture; fullscreen; clipboard-write"
      sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
      allowfullscreen
    />
    <div v-else class="scribe-embed-consent">
      <img
        v-if="thumbnail"
        :src="thumbnail.url"
        :width="thumbnail.width ?? undefined"
        :height="thumbnail.height ?? undefined"
        alt=""
        loading="lazy"
        decoding="async"
        class="scribe-embed-thumbnail"
      />
      <div class="scribe-embed-text">
        <p class="scribe-embed-title">{{ title }}</p>
        <p class="scribe-embed-notice">{{ t('scribe.embed.notice', { service }) }}</p>
        <div class="scribe-embed-actions">
          <button type="button" class="scribe-embed-load" @click="loaded = true">
            {{ t('scribe.embed.load', { service }) }}
          </button>
          <a :href="url" rel="noopener" target="_blank">{{ t('scribe.embed.open', { service }) }}</a>
        </div>
      </div>
    </div>
    <figcaption v-if="caption">{{ caption }}</figcaption>
  </figure>
  <figure v-else-if="isSafeEmbedLink(url)" class="block-embed">
    <a class="block-embed-link" :href="url" rel="noopener" target="_blank">{{ text('title') || url }}</a>
    <figcaption v-if="caption">{{ caption }}</figcaption>
  </figure>
</template>
