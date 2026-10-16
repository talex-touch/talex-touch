<script setup lang="ts">
import type { CSSProperties } from 'vue'
import type { ImageGalleryViewerItem } from './types'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { hasDocument } from '../../../../utils/env'
import TxModal from '../../modal/src/TxModal.vue'

// Internal: TxImageGallery's preview dialog, which TxAttachmentTray opens too. Each host keeps
// its thumbnails and its list and binds `open` and `index`; paging, the keyboard, focus at the
// ends and the loading and failed placeholders are this file's. Not exported.
defineOptions({ name: 'TxImageGalleryViewer' })

const props = withDefaults(defineProps<{
  open: boolean
  index: number
  items: readonly ImageGalleryViewerItem[]
  previewTitle: string
  previousLabel: string
  nextLabel: string
  previousText: string
  nextText: string
  closeLabel: string
  /** TxImageGallery's lightbox, contained in the viewport; otherwise a centred panel. */
  fullscreen?: boolean
  /** URLs the host has seen fail, a thumbnail's say: drawn as the placeholder, not re-requested. */
  failed?: ReadonlySet<string>
}>(), {
  fullscreen: false,
})

const emit = defineEmits<{
  'update:open': [open: boolean]
  'update:index': [index: number]
  'close': []
  'error': [url: string]
}>()

function clamp(index: number): number {
  return Math.min(Math.max(0, index), Math.max(0, props.items.length - 1))
}

// Paging writes this at once and reports it, so two clicks inside one render still page twice;
// the host's own moves (a thumbnail, TxImageGallery's `startIndex`) come back through the prop.
const current = ref(clamp(props.index))

function show(index: number): void {
  current.value = index
  emit('update:index', index)
}

watch(() => props.index, (index) => {
  current.value = clamp(index)
})

// The list is the host's and can change under an open viewer.
watch(() => props.items.length, (length) => {
  if (length === 0 && props.open)
    emit('update:open', false)
  const index = clamp(current.value)
  if (index !== current.value)
    show(index)
})

const item = computed(() => props.items[current.value] ?? null)

// -- Failed pictures become a placeholder instead of the browser's broken-image glyph. Keyed by
// URL, so a host that swaps a failed URL for a new one gets a fresh load.
const failedHere = ref(new Set<string>())

const broken = computed(() =>
  item.value !== null && (props.failed?.has(item.value.url) === true || failedHere.value.has(item.value.url)),
)

// -- Until the picture arrives, a shimmering box the size it is going to take. Every page is
// a new <img>, keyed by URL, so a slow one never shows the previous picture under its title.

// URLs this viewer has drawn: paging back to one shows it straight away.
const loaded = ref(new Set<string>())
// The last picture's own size, the best guess for the next when the host gives none.
const lastShape = ref({ width: 640, height: 480 })
const imageRef = ref<HTMLImageElement | null>(null)

const pending = computed(() => item.value !== null && !broken.value && !loaded.value.has(item.value.url))

// The box holds the picture's place from the start, but its shimmer waits this long, so a
// picture that arrives sooner swaps in without the placeholder flashing first. Once shown it
// stays until nothing is pending, through any paging in between. A local timer, not TxSkeleton's
// `useDeferredLoading`: importing that would add the skeleton's stylesheet to this one's closure.
const SKELETON_DELAY_MS = 150
const skeletonShown = ref(false)
let skeletonTimer: ReturnType<typeof setTimeout> | undefined

function clearSkeletonTimer(): void {
  if (skeletonTimer !== undefined) {
    clearTimeout(skeletonTimer)
    skeletonTimer = undefined
  }
}

// Counted from the dialog opening: a closed viewer's timer would show the shimmer at once.
watch(() => props.open && pending.value, (waiting) => {
  if (!waiting) {
    clearSkeletonTimer()
    skeletonShown.value = false
    return
  }
  if (skeletonShown.value || skeletonTimer !== undefined || !hasDocument())
    return
  skeletonTimer = setTimeout(() => {
    skeletonTimer = undefined
    skeletonShown.value = true
  }, SKELETON_DELAY_MS)
}, { immediate: true })

const skeletonStyle = computed<CSSProperties>(() => {
  const own = item.value?.width && item.value.height ? { width: item.value.width, height: item.value.height } : null
  const { width, height } = own ?? lastShape.value
  const ratio = width / height
  return {
    aspectRatio: `${width} / ${height}`,
    // The picture's own box: contained in the lightbox, otherwise its natural size up to the
    // panel's width and the 70vh the stylesheet caps it at.
    width: props.fullscreen ? `min(100cqw, ${100 * ratio}cqh)` : `min(100%, ${width}px, ${70 * ratio}vh)`,
    visibility: skeletonShown.value ? undefined : 'hidden',
  }
})

// The URL comes off the element, not `item`: an <img> paged away from can still finish loading.
function markLoaded(image: HTMLImageElement): void {
  const url = image.getAttribute('src')
  if (!url)
    return
  if (image.naturalWidth > 0 && image.naturalHeight > 0)
    lastShape.value = { width: image.naturalWidth, height: image.naturalHeight }
  loaded.value = new Set(loaded.value).add(url)
}

function onLoad(event: Event): void {
  markLoaded(event.target as HTMLImageElement)
}

function onError(event: Event): void {
  const url = (event.target as HTMLImageElement).getAttribute('src')
  if (!url)
    return
  failedHere.value = new Set(failedHere.value).add(url)
  emit('error', url)
}

// A picture the browser already holds is complete as soon as its element exists; marked here,
// before the first paint, a cached page never flashes the placeholder.
watch([item, imageRef], () => {
  const image = imageRef.value
  if (image?.complete && image.naturalWidth > 0)
    markLoaded(image)
}, { flush: 'post' })

// -- Paging ---------------------------------------------------------------------------------

const viewerRef = ref<HTMLElement | null>(null)
const previousButton = ref<HTMLButtonElement | null>(null)
const nextButton = ref<HTMLButtonElement | null>(null)

// Paging into either end disables the button that did it, and a disabled button drops focus to
// <body>, outside the dialog: hand it to the opposite button. After a click always, since WebKit
// does not focus a clicked button; after a key only if the button it disables had focus.
async function page(step: -1 | 1, byClick: boolean): Promise<void> {
  const target = current.value + step
  if (target < 0 || target >= props.items.length)
    return
  const source = step < 0 ? previousButton.value : nextButton.value
  const handOff = byClick || (hasDocument() && source !== null && document.activeElement === source)
  show(target)
  await nextTick()
  if (handOff && source?.disabled)
    (step < 0 ? nextButton.value : previousButton.value)?.focus()
}

// ←/→ page while focus is inside this viewer's dialog; TxModal keeps it there, so focus
// anywhere else means another dialog owns the keyboard.
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
    return
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
    return
  const dialog = viewerRef.value?.closest('[role="dialog"]')
  if (!dialog?.contains(document.activeElement))
    return
  event.preventDefault()
  void page(event.key === 'ArrowLeft' ? -1 : 1, false)
}

watch(() => props.open, (open) => {
  if (!hasDocument())
    return
  if (open)
    document.addEventListener('keydown', onKeydown)
  else
    document.removeEventListener('keydown', onKeydown)
}, { immediate: true })

onBeforeUnmount(() => {
  clearSkeletonTimer()
  if (hasDocument())
    document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <TxModal
    :model-value="open"
    :title="item?.name || previewTitle"
    :fullscreen="fullscreen"
    :close-label="closeLabel"
    width="min(92vw, 880px)"
    @update:model-value="emit('update:open', $event)"
    @close="emit('close')"
  >
    <div
      v-if="item"
      ref="viewerRef"
      class="tx-image-gallery__viewer"
      :class="{ 'is-fullscreen': fullscreen }"
      :aria-busy="pending || undefined"
    >
      <svg
        v-if="broken"
        class="tx-image-gallery__broken"
        viewBox="0 0 24 24"
        width="32"
        height="32"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="m3 15 5-5 4 4 3-3 6 6" />
        <circle cx="9" cy="9" r="1.4" />
      </svg>
      <template v-else>
        <span v-if="pending" class="tx-image-gallery__skeleton" :style="skeletonStyle" aria-hidden="true" />
        <img
          v-show="!pending"
          :key="item.url"
          ref="imageRef"
          class="tx-image-gallery__image"
          :src="item.url"
          :alt="item.name ?? ''"
          @load="onLoad"
          @error="onError"
        >
      </template>
    </div>

    <template #footer>
      <div class="tx-image-gallery__footer">
        <button
          ref="previousButton"
          type="button"
          class="tx-image-gallery__nav"
          :aria-label="previousLabel"
          :disabled="current <= 0"
          @click="page(-1, true)"
        >
          {{ previousText }}
        </button>
        <div class="tx-image-gallery__count" aria-live="polite">
          {{ current + 1 }} / {{ items.length }}
        </div>
        <button
          ref="nextButton"
          type="button"
          class="tx-image-gallery__nav"
          :aria-label="nextLabel"
          :disabled="current >= items.length - 1"
          @click="page(1, true)"
        >
          {{ nextText }}
        </button>
      </div>
    </template>
  </TxModal>
</template>

<style lang="scss">
@use '../../../style/mixins.scss' as *;

@include skeleton-keyframes;

// TxModal teleports all of this to <body>, out from under the host, so none of it may be
// nested in a host's class.
.tx-image-gallery__viewer {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 160px;
  color: var(--tx-text-color-secondary, #6b7280);
}

// At its own size, up to the panel's width and 70vh; the placeholder's inline width matches.
.tx-image-gallery__image {
  max-width: 100%;
  max-height: 70vh;
  border: 1px solid var(--tx-border-color-lighter, #e5e7eb);
  border-radius: 14px;
}

.tx-image-gallery__skeleton {
  border-radius: 14px;

  @include skeleton-surface;
}

// The lightbox. The fullscreen modal's body is `flex: 1`; the viewer takes that whole box and
// the picture is contained in it, so it is never letterboxed out of the viewport on either
// axis. A size container, so the placeholder can be fitted the same way.
.tx-image-gallery__viewer.is-fullscreen {
  flex: 1;
  width: 100%;
  min-height: 0;
  container-type: size;
}

// Short selectors to keep the shared sheet small: the viewer is the only `.is-fullscreen`
// these elements are ever children of.
.is-fullscreen > .tx-image-gallery__skeleton {
  border-radius: 6px;
}

.is-fullscreen > .tx-image-gallery__image {
  width: 100%;
  height: 100%;
  max-height: none;
  object-fit: contain;
  border: none;
  border-radius: 6px;
}

.tx-image-gallery__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 12px;
}

.tx-image-gallery__count {
  color: var(--tx-text-color-secondary, #6b7280);
  font-size: 12px;
}

.tx-image-gallery__nav {
  padding: 8px 12px;
  border: 1px solid var(--tx-border-color-lighter, #e5e7eb);
  border-radius: 12px;
  background: var(--tx-fill-color-blank, #fff);
  cursor: pointer;

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  &:focus-visible {
    outline: 2px solid var(--tx-color-primary, #409eff);
    outline-offset: 2px;
  }
}
</style>
