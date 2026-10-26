import type { InjectionKey, Ref } from 'vue'

import type { ContentMediaRef, MediaItem } from '@toascribe/shared'

// The media a document's image blocks use (M1.2): a block stores only the id; the address, the size and the srcset come from here.
// The content API sends them with the document (`ContentItem.media`); the editor adds the files picked from the library.

const KEY: InjectionKey<Ref<Map<string, ContentMediaRef>>> = Symbol('toascribe:media-refs')

/** The reference of a file as the library gives it. */
export function refOfItem(item: MediaItem): ContentMediaRef {
  return {
    id: item.id,
    url: item.url,
    width: item.width,
    height: item.height,
    alt: item.alt,
    mime: item.mime,
    sizes: item.sizes,
  }
}

/** Provides the references to the blocks below; returns the map so the editor can add to it. */
export function provideMediaRefs(initial: readonly ContentMediaRef[] = []): Ref<Map<string, ContentMediaRef>> {
  const refs = ref(new Map(initial.map((entry) => [entry.id, entry])))
  provide(KEY, refs)
  return refs
}

/** The references above this component; an empty map where none were provided. */
export function useMediaRefs(): Ref<Map<string, ContentMediaRef>> {
  return inject(KEY, () => ref(new Map<string, ContentMediaRef>()), true)
}

/** The srcset of a file: every size and the shown image, by width. */
export function srcsetOf(entry: ContentMediaRef): string {
  const widths = new Map(entry.sizes.map((size) => [size.width, size.url]))
  if (entry.width !== null) widths.set(entry.width, entry.url)
  return [...widths]
    .sort(([a], [b]) => a - b)
    .map(([width, url]) => `${url} ${String(width)}w`)
    .join(', ')
}
