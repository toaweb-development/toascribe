<script setup lang="ts">
import type { MediaEditOperation, MediaItem } from '@toascribe/shared'

import type { EditState, Rect } from '~/utils/media-edit'

// «Rediger bilde» (K-114, WordPress' image editor): turn left or right, mirror, crop (drag on the picture or type the numbers) and scale.
// The preview is an SVG: the turn and the mirrorings are one transform of the picture, the crop a rectangle on top, in the pixels of the
// turned picture, which is what the api checks and the worker cuts. Saving sends the steps; the worker makes a new picture and its
// sizes, and the original stays as it was uploaded.
const props = defineProps<{
  item: MediaItem
  save: (operations: MediaEditOperation[]) => Promise<string | undefined>
}>()
const emit = defineEmits<{ close: [saved: boolean] }>()
const uid = useId()

const width = props.item.width ?? 1
const height = props.item.height ?? 1
const state = ref<EditState>(NO_EDIT)
const size = computed(() => turnedSize(width, height, state.value.turn))
const transform = computed(() => previewMatrix(width, height, state.value))
const operations = computed(() => operationsOf(width, height, state.value))
const result = computed(() => {
  const cropped = croppedSize(width, height, state.value)
  const scale = state.value.scaleWidth
  return scale !== null && scale >= 1 && scale < cropped.width
    ? { width: Math.round(scale), height: Math.max(1, Math.round((cropped.height * scale) / cropped.width)) }
    : cropped
})

// The numbers of the crop, as typed; applied when they make a rectangle inside the picture.
const fields = reactive({ x: 0, y: 0, width: 0, height: 0 })
watch(
  () => state.value.crop,
  (crop) => Object.assign(fields, crop ?? { x: 0, y: 0, width: 0, height: 0 }),
)
function applyFields(): void {
  state.value = { ...state.value, crop: fittedCrop(fields, size.value), scaleWidth: null }
}

// --- Drawing the crop with a pointer ---------------------------------------------------------------------------------------------------
const svg = useTemplateRef<SVGSVGElement>('svg')
let start: { x: number; y: number } | null = null
function pointOf(event: PointerEvent): { x: number; y: number } | null {
  const matrix = svg.value?.getScreenCTM()
  if (!svg.value || !matrix) return null
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
  return { x: point.x, y: point.y }
}
function onDown(event: PointerEvent): void {
  start = pointOf(event)
  if (start !== null) (event.currentTarget as Element).setPointerCapture(event.pointerId)
}
function onMove(event: PointerEvent): void {
  const here = start === null ? null : pointOf(event)
  if (start === null || here === null) return
  const rect: Rect = rectBetween(start, here, size.value)
  state.value = { ...state.value, crop: rect.width >= 1 && rect.height >= 1 ? rect : null, scaleWidth: null }
}
function onUp(): void {
  start = null
}

const scaleText = computed({
  get: () => (state.value.scaleWidth === null ? '' : String(state.value.scaleWidth)),
  set: (value: string) => {
    const number = Number(value)
    state.value = {
      ...state.value,
      scaleWidth: value.trim() === '' || !Number.isInteger(number) || number < 1 ? null : number,
    }
  },
})

const saving = ref(false)
const failure = ref<string>()
async function submit(): Promise<void> {
  if (saving.value || operations.value.length === 0) return
  saving.value = true
  failure.value = undefined
  try {
    failure.value = await props.save(operations.value)
    if (failure.value === undefined) emit('close', true)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal :title="$t('media.edit.title')" fullscreen :ui="{ footer: 'justify-end' }">
    <template #body>
      <div class="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div class="flex flex-col gap-2">
          <svg
            ref="svg"
            :viewBox="`0 0 ${size.width} ${size.height}`"
            class="h-auto max-h-[70vh] w-full touch-none select-none rounded-md bg-elevated"
            role="img"
            :aria-label="$t('media.edit.preview', { title: item.title || item.fileName })"
            @pointerdown="onDown"
            @pointermove="onMove"
            @pointerup="onUp"
            @pointercancel="onUp"
          >
            <image :href="item.url" :width="width" :height="height" :transform="transform" preserveAspectRatio="none" />
            <template v-if="state.crop">
              <path
                :d="`M0 0H${size.width}V${size.height}H0Z M${state.crop.x} ${state.crop.y}v${state.crop.height}h${state.crop.width}v${-state.crop.height}Z`"
                fill-rule="evenodd"
                class="fill-black/50"
              />
              <rect
                :x="state.crop.x"
                :y="state.crop.y"
                :width="state.crop.width"
                :height="state.crop.height"
                fill="none"
                class="stroke-white"
                vector-effect="non-scaling-stroke"
                stroke-width="2"
                stroke-dasharray="6 4"
              />
            </template>
          </svg>
          <p class="text-sm text-toned">{{ $t('media.edit.dragHelp') }}</p>
        </div>

        <div class="flex flex-col gap-5">
          <div class="flex flex-wrap gap-2" role="group" :aria-label="$t('media.edit.turnAndFlip')">
            <UButton
              icon="i-lucide-rotate-ccw"
              color="neutral"
              variant="outline"
              class="min-h-11"
              :label="$t('media.edit.rotateLeft')"
              @click="state = turned(state, -1)"
            />
            <UButton
              icon="i-lucide-rotate-cw"
              color="neutral"
              variant="outline"
              class="min-h-11"
              :label="$t('media.edit.rotateRight')"
              @click="state = turned(state, 1)"
            />
            <UButton
              icon="i-lucide-flip-vertical-2"
              color="neutral"
              variant="outline"
              class="min-h-11"
              :aria-pressed="state.flipVertical"
              :label="$t('media.edit.flipVertical')"
              @click="state = { ...state, flipVertical: !state.flipVertical }"
            />
            <UButton
              icon="i-lucide-flip-horizontal-2"
              color="neutral"
              variant="outline"
              class="min-h-11"
              :aria-pressed="state.flipHorizontal"
              :label="$t('media.edit.flipHorizontal')"
              @click="state = { ...state, flipHorizontal: !state.flipHorizontal }"
            />
          </div>

          <fieldset class="flex flex-col gap-3">
            <legend class="mb-2 font-semibold text-highlighted">{{ $t('media.edit.crop') }}</legend>
            <div class="grid grid-cols-2 gap-3">
              <UFormField :label="$t('media.edit.cropX')" :name="`${uid}-x`">
                <UInput
                  v-model.number="fields.x"
                  type="number"
                  min="0"
                  size="xl"
                  class="w-full"
                  @change="applyFields"
                />
              </UFormField>
              <UFormField :label="$t('media.edit.cropY')" :name="`${uid}-y`">
                <UInput
                  v-model.number="fields.y"
                  type="number"
                  min="0"
                  size="xl"
                  class="w-full"
                  @change="applyFields"
                />
              </UFormField>
              <UFormField :label="$t('media.settings.width')" :name="`${uid}-w`">
                <UInput
                  v-model.number="fields.width"
                  type="number"
                  min="1"
                  size="xl"
                  class="w-full"
                  @change="applyFields"
                />
              </UFormField>
              <UFormField :label="$t('media.settings.height')" :name="`${uid}-h`">
                <UInput
                  v-model.number="fields.height"
                  type="number"
                  min="1"
                  size="xl"
                  class="w-full"
                  @change="applyFields"
                />
              </UFormField>
            </div>
            <div>
              <UButton
                v-if="state.crop"
                color="neutral"
                variant="ghost"
                class="min-h-11"
                :label="$t('media.edit.cropClear')"
                @click="state = { ...state, crop: null }"
              />
            </div>
          </fieldset>

          <UFormField
            :label="$t('media.edit.scale')"
            :help="$t('media.edit.scaleHelp', { width: croppedSize(width, height, state).width })"
            :name="`${uid}-scale`"
          >
            <UInput v-model="scaleText" type="number" min="1" size="xl" class="w-full" />
          </UFormField>

          <p class="text-sm text-default" role="status">
            {{ $t('media.edit.result', { width: result.width, height: result.height }) }}
          </p>
          <p class="text-sm text-toned">{{ $t('media.edit.originalKept') }}</p>
          <UAlert
            v-if="failure"
            color="error"
            variant="subtle"
            role="alert"
            icon="i-lucide-triangle-alert"
            :title="$t('media.edit.failed')"
            :description="failure"
          />
        </div>
      </div>
    </template>
    <template #footer>
      <UButton
        color="neutral"
        variant="ghost"
        size="lg"
        class="min-h-11"
        :disabled="operations.length === 0"
        @click="state = NO_EDIT"
      >
        {{ $t('media.edit.reset') }}
      </UButton>
      <UButton color="neutral" variant="outline" size="lg" class="min-h-11" @click="emit('close', false)">
        {{ $t('content.quickEdit.cancel') }}
      </UButton>
      <UButton size="lg" class="min-h-11" :loading="saving" :disabled="operations.length === 0" @click="submit">
        {{ $t('media.edit.save') }}
      </UButton>
    </template>
  </UModal>
</template>
