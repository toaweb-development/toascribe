<script setup lang="ts">
import type { MenuDetail, MenuItem, MenuItemKind } from '@toascribe/shared'

// «Utseende → Menyer» (K-132; WordPress' nav-menus.php): one tab to edit a menu, one for «Administrer plasseringer». A menu's items
// are pages, posts, categories, tags and links of one's own, added from the boxes on the left; their order and levels change with
// drag and drop, with the buttons on each item, and with Alt and the arrow keys on an item. «Lagre meny» stores the whole tree.
// Needs `edit_theme_options`.
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t } = useI18n()
const auth = useAuth()
const appearanceApi = useAppearanceApi()
const contentApi = useContentApi()
const termsApi = useTermsApi()
const activeTheme = useActiveTheme()
const confirm = useConfirmDialog()
useSeoMeta({ title: () => t('appearance.menus.title') })

const mayEdit = computed(
  () =>
    auth.session.value.status === 'authenticated' &&
    auth.session.value.account.capabilities.includes('edit_theme_options'),
)
if (import.meta.server && !mayEdit.value) {
  const event = useRequestEvent()
  if (event) setResponseStatus(event, 403)
}

const tab = ref<'edit' | 'locations'>('edit')
const tabs = computed(() => [
  { label: t('appearance.menus.editTab'), value: 'edit' },
  { label: t('appearance.menus.locationsTab'), value: 'locations' },
])

const { data: menus, refresh: refreshMenus } = await useAsyncData('appearance:menus', () => appearanceApi.menus(), {
  enabled: mayEdit,
})
const selectedId = ref<string>()
const menu = ref<MenuDetail>()
const name = ref('')
const items = ref<MenuItem[]>([])
const saving = ref(false)
const report = ref<string>()
const failure = ref<string>()

async function open(id: string | undefined): Promise<void> {
  failure.value = undefined
  if (id === undefined) {
    menu.value = undefined
    items.value = []
    return
  }
  try {
    menu.value = await appearanceApi.menu(id)
    name.value = menu.value.name
    items.value = structuredClone(toRaw(menu.value.items)) as MenuItem[]
    expanded.value = null
  } catch (caught) {
    failure.value = describeApiError(caught, t)
  }
}
// The first menu is opened before the page is drawn, so the server and the browser draw the same page.
selectedId.value = menus.value?.items[0]?.id
await open(selectedId.value)
watch(selectedId, (id) => open(id))
const menuChoices = computed(() => (menus.value?.items ?? []).map((entry) => ({ label: entry.name, value: entry.id })))

const newName = ref('')
async function create(): Promise<void> {
  const value = newName.value.trim()
  if (value === '') return
  try {
    const created = await appearanceApi.createMenu(value)
    newName.value = ''
    await refreshMenus()
    selectedId.value = created.id
    report.value = t('appearance.menus.created', { name: created.name })
  } catch (caught) {
    failure.value = describeApiError(caught, t)
  }
}

async function save(): Promise<void> {
  if (menu.value === undefined || saving.value) return
  saving.value = true
  report.value = undefined
  failure.value = undefined
  try {
    menu.value = await appearanceApi.saveMenu(menu.value.id, { name: name.value, items: items.value })
    items.value = structuredClone(toRaw(menu.value.items)) as MenuItem[]
    await refreshMenus()
    report.value = t('appearance.menus.saved')
  } catch (caught) {
    failure.value = describeApiError(caught, t)
  } finally {
    saving.value = false
  }
}

async function remove(): Promise<void> {
  if (menu.value === undefined) return
  const ok = await confirm.ask({
    title: t('appearance.menus.delete'),
    description: t('appearance.menus.deleteConfirm', { name: menu.value.name }),
    confirmLabel: t('appearance.menus.delete'),
    cancelLabel: t('content.quickEdit.cancel'),
    color: 'error',
  })
  if (!ok) return
  try {
    await appearanceApi.deleteMenu(menu.value.id)
    selectedId.value = undefined
    await refreshMenus()
    selectedId.value = menus.value?.items[0]?.id
    report.value = t('appearance.menus.deleted')
  } catch (caught) {
    failure.value = describeApiError(caught, t)
  }
}

// What can be added (the boxes on the left): published pages and the latest posts, categories, tags, a link of one's own.
const { data: sources } = await useAsyncData(
  'appearance:menu-sources',
  async () => {
    const [pages, posts, categories, tags] = await Promise.all([
      contentApi.list({ type: 'page', status: 'publish', per_page: 100, orderby: 'title', order: 'asc' }),
      contentApi.list({ type: 'post', status: 'publish', per_page: 20 }),
      termsApi.all('category'),
      termsApi.all('post_tag'),
    ])
    const entry = (id: string, title: string) => ({ id, title: titleOf(t, title) })
    return {
      page: pages.items.map((item) => entry(item.id, item.title)),
      post: posts.items.map((item) => entry(item.id, item.title)),
      category: categories.map((term) => entry(term.id, term.name)),
      post_tag: tags.map((term) => entry(term.id, term.name)),
    }
  },
  { enabled: mayEdit },
)
const SOURCES = ['page', 'post', 'category', 'post_tag'] as const
const sourceLabel = (kind: (typeof SOURCES)[number]) =>
  kind === 'page'
    ? t('appearance.menus.pages')
    : kind === 'post'
      ? t('appearance.menus.posts')
      : kind === 'category'
        ? t('appearance.menus.categories')
        : t('appearance.menus.tags')
const chosen = reactive<Record<string, string[]>>({ page: [], post: [], category: [], post_tag: [] })
const titles = computed(() => {
  const found = new Map<string, string>()
  for (const kind of SOURCES) for (const entry of sources.value?.[kind] ?? []) found.set(entry.id, entry.title)
  for (const view of menu.value?.views ?? []) if (view.objectTitle !== null) found.set(view.id, view.objectTitle)
  return found
})
/** A new item's empty text fields (its label falls back to its content's title). */
const BLANK = ''
const newItem = (kind: MenuItemKind, fields: Partial<MenuItem>): MenuItem => ({
  id: newMenuItemId(),
  kind,
  label: BLANK,
  newTab: false,
  cssClass: BLANK,
  description: BLANK,
  children: [],
  ...fields,
})
function addChosen(kind: (typeof SOURCES)[number]): void {
  const picked = chosen[kind] ?? []
  items.value = [...items.value, ...picked.map((objectId) => newItem(kind, { objectId }))]
  chosen[kind] = []
}
function toggleChosen(kind: string, id: string, on: boolean | 'indeterminate'): void {
  const list = chosen[kind] ?? []
  chosen[kind] = on === true ? [...list, id] : list.filter((entry) => entry !== id)
}
const customUrl = ref('https://')
const customLabel = ref('')
function addCustom(): void {
  if (customUrl.value.trim() === '' || customUrl.value.trim() === 'https://') return
  items.value = [...items.value, newItem('custom', { url: customUrl.value.trim(), label: customLabel.value.trim() })]
  customUrl.value = 'https://'
  customLabel.value = ''
}

// The tree on the right.
const rows = computed(() => menuFlatten(items.value))
const expanded = ref<string | null>(null)
const objectTitleOf = (item: MenuItem) =>
  item.objectId === undefined
    ? null
    : (titles.value.get(item.objectId) ?? menu.value?.views.find((view) => view.id === item.id)?.objectTitle ?? null)
const shownLabel = (item: MenuItem) =>
  item.label.trim() || objectTitleOf(item) || item.url || t('appearance.menus.untitled')
const kindLabel = (kind: MenuItemKind) =>
  kind === 'page'
    ? t('appearance.menus.kindPage')
    : kind === 'post'
      ? t('appearance.menus.kindPost')
      : kind === 'category'
        ? t('appearance.menus.kindCategory')
        : kind === 'post_tag'
          ? t('appearance.menus.kindTag')
          : t('appearance.menus.kindCustom')
const hidden = (item: MenuItem) => menu.value?.views.find((view) => view.id === item.id)?.shown === false
const INDENT = ['ps-0', 'ps-6', 'ps-12', 'ps-18', 'ps-24', 'ps-30', 'ps-36', 'ps-42', 'ps-48', 'ps-54'] as const
const announce = ref('')

function act(id: string, action: 'up' | 'down' | 'in' | 'out' | 'remove'): void {
  const before = JSON.stringify(items.value)
  items.value =
    action === 'up'
      ? menuMoveUp(items.value, id)
      : action === 'down'
        ? menuMoveDown(items.value, id)
        : action === 'in'
          ? menuIndent(items.value, id)
          : action === 'out'
            ? menuOutdent(items.value, id)
            : menuRemoveItem(items.value, id)
  if (JSON.stringify(items.value) === before) return
  const row = rows.value.find((entry) => entry.item.id === id)
  announce.value =
    row === undefined
      ? t('appearance.menus.removed')
      : t('appearance.menus.movedTo', { label: shownLabel(row.item), level: row.depth + 1 })
  // The moved item keeps the focus (its row is drawn anew).
  void nextTick(() => document.getElementById(`menu-item-${id}`)?.focus())
}
function onKey(event: KeyboardEvent, id: string): void {
  if (!event.altKey) return
  const action = { ArrowUp: 'up', ArrowDown: 'down', ArrowRight: 'in', ArrowLeft: 'out' }[event.key] as
    'up' | 'down' | 'in' | 'out' | undefined
  if (action === undefined) return
  event.preventDefault()
  act(id, action)
}
function set(id: string, fields: Partial<MenuItem>): void {
  items.value = menuUpdateItem(items.value, id, fields)
}

// Drag and drop: the upper half of a row puts the item before it, the lower half after it, and the lower half far to the right inside it.
const dragging = ref<string | null>(null)
const dropHint = ref<{ id: string; position: MenuDropPosition } | null>(null)
function positionOf(event: DragEvent): MenuDropPosition {
  const target = event.currentTarget as HTMLElement
  const box = target.getBoundingClientRect()
  if (event.clientY < box.top + box.height / 2) return 'before'
  return event.clientX > box.left + 96 ? 'inside' : 'after'
}
function onDragStart(event: DragEvent, id: string): void {
  dragging.value = id
  event.dataTransfer?.setData('text/plain', id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function onDragOver(event: DragEvent, id: string): void {
  if (dragging.value === null || dragging.value === id) return
  event.preventDefault()
  dropHint.value = { id, position: positionOf(event) }
}
function onDrop(event: DragEvent, id: string): void {
  event.preventDefault()
  if (dragging.value !== null && dragging.value !== id) {
    items.value = menuMoveTo(items.value, dragging.value, id, positionOf(event))
  }
  dragging.value = null
  dropHint.value = null
}
function onDragEnd(): void {
  dragging.value = null
  dropHint.value = null
}

// «Administrer plasseringer»: the active theme's locations, each with a menu or none.
const { data: placed, refresh: refreshLocations } = await useAsyncData(
  'appearance:menu-locations',
  () => appearanceApi.locations(),
  {
    enabled: mayEdit,
  },
)
const NONE = '__none__'
const locationForm = ref<Record<string, string>>({})
watch(
  placed,
  (loaded) => {
    if (loaded)
      locationForm.value = Object.fromEntries(Object.entries(loaded.locations).map(([key, id]) => [key, id ?? NONE]))
  },
  { immediate: true },
)
const locationRows = computed(() =>
  Object.entries(activeTheme.value?.menus ?? {}).map(([slug, label]) => ({ slug, label })),
)
const locationChoices = computed(() => [{ label: t('appearance.menus.noMenu'), value: NONE }, ...menuChoices.value])
async function saveLocations(): Promise<void> {
  report.value = undefined
  failure.value = undefined
  try {
    const locations = Object.fromEntries(
      locationRows.value.map(({ slug }) => [
        slug,
        locationForm.value[slug] === NONE ? null : (locationForm.value[slug] ?? null),
      ]),
    )
    await appearanceApi.saveLocations({ ...(placed.value?.locations ?? {}), ...locations })
    await refreshLocations()
    report.value = t('appearance.menus.locationsSaved')
  } catch (caught) {
    failure.value = describeApiError(caught, t)
  }
}
</script>

<template>
  <UDashboardPanel id="appearance-menus">
    <template #header>
      <UDashboardNavbar :title="$t('appearance.menus.title')" />
    </template>
    <template #body>
      <section v-if="!mayEdit" aria-labelledby="menus-denied" class="flex max-w-prose flex-col gap-3">
        <h2 id="menus-denied" class="text-xl font-semibold text-highlighted">{{ $t('appearance.denied') }}</h2>
        <p class="text-base text-default">{{ $t('content.denied.text') }}</p>
      </section>
      <div v-else class="flex flex-col gap-6">
        <UTabs v-model="tab" :items="tabs" :content="false" color="neutral" variant="link" class="w-full" />
        <div role="status">
          <UAlert v-if="report" color="success" variant="subtle" icon="i-lucide-circle-check" :title="report" />
        </div>
        <UAlert
          v-if="failure"
          color="error"
          variant="subtle"
          role="alert"
          icon="i-lucide-triangle-alert"
          :title="$t('appearance.menus.failed')"
          :description="failure"
        />

        <template v-if="tab === 'edit'">
          <div class="flex flex-wrap items-end gap-3">
            <UFormField v-if="menuChoices.length > 0" :label="$t('appearance.menus.choose')" name="menu-choose">
              <USelect v-model="selectedId" :items="menuChoices" size="xl" class="w-full sm:w-72" />
            </UFormField>
            <form class="flex flex-wrap items-end gap-2" @submit.prevent="create">
              <UFormField :label="$t('appearance.menus.newName')" name="menu-new">
                <UInput v-model="newName" maxlength="200" size="xl" class="w-full sm:w-64" />
              </UFormField>
              <UButton type="submit" color="neutral" variant="outline" size="lg" class="min-h-11">{{
                $t('appearance.menus.create')
              }}</UButton>
            </form>
          </div>

          <div v-if="menu" class="grid gap-6 lg:grid-cols-[18rem_1fr]">
            <section aria-labelledby="menu-add" class="flex flex-col gap-4">
              <h2 id="menu-add" class="text-lg font-semibold text-highlighted">{{ $t('appearance.menus.add') }}</h2>
              <fieldset
                v-for="kind in SOURCES"
                :key="kind"
                class="flex flex-col gap-2 rounded border border-default p-3"
              >
                <legend class="px-1 font-semibold text-highlighted">{{ sourceLabel(kind) }}</legend>
                <p v-if="(sources?.[kind] ?? []).length === 0" class="text-sm text-muted">
                  {{ $t('appearance.menus.none') }}
                </p>
                <div v-else class="flex max-h-48 flex-col gap-1 overflow-y-auto">
                  <UCheckbox
                    v-for="entry in sources?.[kind] ?? []"
                    :key="entry.id"
                    :model-value="chosen[kind]?.includes(entry.id) ?? false"
                    :label="entry.title"
                    @update:model-value="toggleChosen(kind, entry.id, $event)"
                  />
                </div>
                <UButton
                  color="neutral"
                  variant="outline"
                  size="sm"
                  class="min-h-11 self-start"
                  :disabled="(chosen[kind] ?? []).length === 0"
                  @click="addChosen(kind)"
                  >{{ $t('appearance.menus.addTo', { what: sourceLabel(kind) }) }}</UButton
                >
              </fieldset>
              <fieldset class="flex flex-col gap-2 rounded border border-default p-3">
                <legend class="px-1 font-semibold text-highlighted">{{ $t('appearance.menus.custom') }}</legend>
                <UFormField :label="$t('appearance.menus.url')" name="custom-url">
                  <UInput v-model="customUrl" type="url" maxlength="2000" class="w-full" />
                </UFormField>
                <UFormField :label="$t('appearance.menus.linkText')" name="custom-label">
                  <UInput v-model="customLabel" maxlength="200" class="w-full" />
                </UFormField>
                <UButton color="neutral" variant="outline" size="sm" class="min-h-11 self-start" @click="addCustom">{{
                  $t('appearance.menus.addTo', { what: $t('appearance.menus.custom') })
                }}</UButton>
              </fieldset>
            </section>

            <section aria-labelledby="menu-structure" class="flex flex-col gap-4">
              <h2 id="menu-structure" class="text-lg font-semibold text-highlighted">
                {{ $t('appearance.menus.structure') }}
              </h2>
              <UFormField :label="$t('appearance.menus.name')" name="menu-name">
                <UInput v-model="name" maxlength="200" size="xl" class="w-full sm:w-80" />
              </UFormField>
              <p class="text-sm text-toned">{{ $t('appearance.menus.structureHelp') }}</p>
              <p v-if="rows.length === 0" class="text-sm text-muted">{{ $t('appearance.menus.empty') }}</p>
              <ol v-else class="flex flex-col gap-2" :aria-label="$t('appearance.menus.items')">
                <li
                  v-for="row in rows"
                  :id="`menu-item-${row.item.id}`"
                  :key="row.item.id"
                  :class="[
                    INDENT[Math.min(row.depth, INDENT.length - 1)],
                    dropHint?.id === row.item.id && dropHint.position === 'before' ? 'border-t-2 border-primary' : '',
                    dropHint?.id === row.item.id && dropHint.position === 'after' ? 'border-b-2 border-primary' : '',
                  ]"
                  tabindex="-1"
                  :aria-label="$t('appearance.menus.itemLabel', { label: shownLabel(row.item), level: row.depth + 1 })"
                  @keydown="onKey($event, row.item.id)"
                  @dragover="onDragOver($event, row.item.id)"
                  @drop="onDrop($event, row.item.id)"
                >
                  <div
                    class="flex flex-col gap-2 rounded border bg-default p-2"
                    :class="
                      dropHint?.id === row.item.id && dropHint.position === 'inside'
                        ? 'border-primary'
                        : 'border-default'
                    "
                  >
                    <div class="flex flex-wrap items-center gap-2">
                      <span
                        draggable="true"
                        class="cursor-grab px-1 text-muted"
                        :title="$t('appearance.menus.drag')"
                        aria-hidden="true"
                        @dragstart="onDragStart($event, row.item.id)"
                        @dragend="onDragEnd"
                        >⠿</span
                      >
                      <span class="font-semibold text-highlighted">{{ shownLabel(row.item) }}</span>
                      <span class="text-sm text-muted">{{ kindLabel(row.item.kind) }}</span>
                      <UBadge v-if="hidden(row.item)" color="warning" variant="subtle">{{
                        $t('appearance.menus.notShown')
                      }}</UBadge>
                      <span class="ms-auto flex flex-wrap gap-1">
                        <UButton
                          color="neutral"
                          variant="ghost"
                          size="sm"
                          class="min-h-11"
                          icon="i-lucide-arrow-up"
                          :disabled="row.first"
                          :aria-label="$t('appearance.menus.up', { label: shownLabel(row.item) })"
                          @click="act(row.item.id, 'up')"
                        />
                        <UButton
                          color="neutral"
                          variant="ghost"
                          size="sm"
                          class="min-h-11"
                          icon="i-lucide-arrow-down"
                          :disabled="row.last"
                          :aria-label="$t('appearance.menus.down', { label: shownLabel(row.item) })"
                          @click="act(row.item.id, 'down')"
                        />
                        <UButton
                          color="neutral"
                          variant="ghost"
                          size="sm"
                          class="min-h-11"
                          icon="i-lucide-arrow-right"
                          :disabled="row.first"
                          :aria-label="$t('appearance.menus.in', { label: shownLabel(row.item) })"
                          @click="act(row.item.id, 'in')"
                        />
                        <UButton
                          color="neutral"
                          variant="ghost"
                          size="sm"
                          class="min-h-11"
                          icon="i-lucide-arrow-left"
                          :disabled="row.depth === 0"
                          :aria-label="$t('appearance.menus.out', { label: shownLabel(row.item) })"
                          @click="act(row.item.id, 'out')"
                        />
                        <UButton
                          color="neutral"
                          variant="ghost"
                          size="sm"
                          class="min-h-11"
                          icon="i-lucide-pencil"
                          :aria-expanded="expanded === row.item.id ? 'true' : 'false'"
                          :aria-label="$t('appearance.menus.editItem', { label: shownLabel(row.item) })"
                          @click="expanded = expanded === row.item.id ? null : row.item.id"
                        />
                      </span>
                    </div>
                    <div v-if="expanded === row.item.id" class="grid gap-3 sm:grid-cols-2">
                      <UFormField
                        v-if="row.item.kind === 'custom'"
                        :label="$t('appearance.menus.url')"
                        :name="`url-${row.item.id}`"
                        class="sm:col-span-2"
                      >
                        <UInput
                          :model-value="row.item.url ?? ''"
                          maxlength="2000"
                          class="w-full"
                          @update:model-value="(value: string | number) => set(row.item.id, { url: String(value) })"
                        />
                      </UFormField>
                      <UFormField :label="$t('appearance.menus.navLabel')" :name="`label-${row.item.id}`">
                        <UInput
                          :model-value="row.item.label"
                          :placeholder="objectTitleOf(row.item) ?? ''"
                          maxlength="200"
                          class="w-full"
                          @update:model-value="(value: string | number) => set(row.item.id, { label: String(value) })"
                        />
                      </UFormField>
                      <UFormField :label="$t('appearance.menus.cssClass')" :name="`css-${row.item.id}`">
                        <UInput
                          :model-value="row.item.cssClass"
                          maxlength="200"
                          class="w-full"
                          @update:model-value="
                            (value: string | number) => set(row.item.id, { cssClass: String(value) })
                          "
                        />
                      </UFormField>
                      <UFormField
                        :label="$t('appearance.menus.description')"
                        :name="`description-${row.item.id}`"
                        class="sm:col-span-2"
                      >
                        <UTextarea
                          :model-value="row.item.description"
                          maxlength="500"
                          :rows="2"
                          class="w-full"
                          @update:model-value="(value: string) => set(row.item.id, { description: value })"
                        />
                      </UFormField>
                      <UCheckbox
                        :model-value="row.item.newTab"
                        :label="$t('appearance.menus.newTab')"
                        @update:model-value="
                          (value: boolean | 'indeterminate') => set(row.item.id, { newTab: value === true })
                        "
                      />
                      <UButton
                        color="error"
                        variant="outline"
                        size="sm"
                        class="min-h-11 self-start"
                        @click="act(row.item.id, 'remove')"
                        >{{ $t('appearance.menus.remove') }}</UButton
                      >
                    </div>
                  </div>
                </li>
              </ol>
              <p class="sr-only" aria-live="polite">{{ announce }}</p>
              <div class="flex flex-wrap gap-3">
                <UButton size="lg" class="min-h-11" :loading="saving" @click="save">{{
                  $t('appearance.menus.save')
                }}</UButton>
                <UButton color="error" variant="outline" size="lg" class="min-h-11" @click="remove">{{
                  $t('appearance.menus.delete')
                }}</UButton>
              </div>
            </section>
          </div>
          <p v-else class="text-base text-default">{{ $t('appearance.menus.first') }}</p>
        </template>

        <form v-else class="flex max-w-2xl flex-col gap-4" @submit.prevent="saveLocations">
          <p class="text-base text-default">{{ $t('appearance.menus.locationsHelp') }}</p>
          <p v-if="locationRows.length === 0" class="text-sm text-muted">{{ $t('appearance.menus.noLocations') }}</p>
          <UFormField v-for="row in locationRows" :key="row.slug" :label="row.label" :name="`location-${row.slug}`">
            <USelect v-model="locationForm[row.slug]" :items="locationChoices" size="xl" class="w-full sm:w-72" />
          </UFormField>
          <div>
            <UButton type="submit" size="lg" class="min-h-11">{{ $t('appearance.menus.saveLocations') }}</UButton>
          </div>
        </form>
      </div>
    </template>
  </UDashboardPanel>
</template>
