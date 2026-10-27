// The view of a block document as a Vue component, for a page that draws it among other things (the admin's preview, the site's
// post template in M1.4). It renders the same elements as renderDocument.
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'

import type { Block } from '@toascribe/blocks'
import type { ContentMediaRef } from '@toascribe/shared'

import { renderDocument } from './render.ts'

/** The default `sizes` of an image: the content column, at most 48rem wide (a theme passes its own). */
export const DEFAULT_IMAGE_SIZES = '(min-width: 48rem) 48rem, 100vw'

export const BlockDocument = defineComponent({
  name: 'BlockDocument',
  props: {
    /** A document that passed validateDocument. */
    blocks: { type: Array as PropType<readonly Block[]>, required: true },
    /** The media the blocks use (ContentItem.media). */
    media: { type: Array as PropType<readonly ContentMediaRef[]>, default: () => [] },
    imageSizes: { type: String, default: DEFAULT_IMAGE_SIZES },
    /** `raw` writes custom HTML as markup: for the public site only (see ViewContext.html). The default shows it as text. */
    html: { type: String as PropType<'raw' | 'source'>, default: 'source' },
  },
  setup(props) {
    const media = computed(() => new Map(props.media.map((entry) => [entry.id, entry])))
    return () => renderDocument(props.blocks, { media: media.value, imageSizes: props.imageSizes, html: props.html })
  },
})
