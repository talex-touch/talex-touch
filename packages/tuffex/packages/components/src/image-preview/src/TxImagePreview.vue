<script setup lang="ts">
import type { CSSProperties } from 'vue'
import type { FlightPose, PreviewOrigin } from './flight'
import type { ImagePreviewEmits, ImagePreviewIndicator, ImagePreviewItem, ImagePreviewProps } from './types'
import type { PreviewBox, PreviewPoint, PreviewSize, PreviewView } from './zoom'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { hasDocument } from '../../../../utils/env'
import { useReducedMotion } from '../../../../utils/use-reduced-motion'
import { isTopmostModalDialog, useZIndexAllocator } from '../../../../utils/z-index-manager'
import TxBaseSurface from '../../base-surface/src/TxBaseSurface.vue'
import { isOriginInView, lerpPose, originPose, poseStyles, resolveOrigin, uprightAngle, viewPose } from './flight'
import ImagePreviewStrip from './ImagePreviewStrip.vue'
import ImagePreviewToolbar from './ImagePreviewToolbar.vue'
import { ACTION_ICONS, usePreviewActions } from './use-preview-actions'
import { SLIDE_GAP, usePreviewGestures } from './use-preview-gestures'
import { usePreviewMenu } from './use-preview-menu'
import { usePreviewPictures } from './use-preview-pictures'
import { usePreviewTransition } from './use-preview-transition'
import { fitView } from './zoom'

// One picture at a time over the whole window, with its neighbours waiting on either side. The
// hands are use-preview-gestures'; the comings and goings use-preview-transition's, and a flight
// between a thumbnail and the stage is drawn with flight's poses. The pictures' loading is
// use-preview-pictures', the actions use-preview-actions' and their menu use-preview-menu's, and
// the strip along the bottom ImagePreviewStrip's. This file owns opening and closing, focus, the
// keyboard, and the chrome around it all, which a touch tap hides and shows.

// Resolved in setup: inject is only valid here, while allocation happens on opening.
const zIndexAllocator = useZIndexAllocator()

defineOptions({ name: 'TxImagePreview' })

const props = withDefaults(defineProps<ImagePreviewProps>(), {
  images: () => [],
  maxScale: 4,
  transition: 'zoom',
  actions: () => ['rotate', 'copy', 'share', 'download'],
  contextMenu: true,
  indicator: 'thumbnails',
  bounce: 0.2,
  maskSurface: 'refraction',
  maskColor: 'rgb(10, 10, 12)',
  maskOpacity: 0.6,
  maskBlur: 12,
  controlSurface: 'blur',
  controlColor: 'rgb(64, 64, 70)',
  controlOpacity: 0.6,
  controlBlur: 16,
  label: 'Image preview',
  closeLabel: 'Close',
  previousLabel: 'Previous image',
  nextLabel: 'Next image',
  zoomInLabel: 'Zoom in',
  zoomOutLabel: 'Zoom out',
  resetLabel: 'Fit to screen',
  rotateLabel: 'Rotate',
  copyLabel: 'Copy image',
  shareLabel: 'Share',
  downloadLabel: 'Download',
  menuLabel: 'Image actions',
  indicatorLabel: 'Images',
  copiedText: 'Image copied',
  linkCopiedText: 'Link copied',
  copyFailedText: 'Could not copy the image',
  failedText: 'This image could not be loaded',
  counterFormatter: (current: number, total: number) => `${current} / ${total}`,
  scaleFormatter: (scale: number) => `${Math.round(scale * 100)}%`,
  indicatorItemFormatter: (current: number, total: number, name?: string) =>
    name ? `${name}, ${current} of ${total}` : `Image ${current} of ${total}`,
  labelFormatter: (label: string, name: string) => `${label}: ${name}`,
  readoutLabelFormatter: (readout: string, label: string) => `${readout}, ${label}`,
})

const emit = defineEmits<ImagePreviewEmits>()

const open = defineModel<boolean>('open', { default: false })
const index = defineModel<number>('index', { default: 0 })

const reduced = useReducedMotion()

const items = computed<ImagePreviewItem[]>(() =>
  (props.images ?? []).map(source => (typeof source === 'string' ? { url: source } : source)),
)
const count = computed(() => items.value.length)

function clampIndex(value: number): number {
  const safe = Number.isFinite(value) ? Math.round(value) : 0
  return Math.min(Math.max(0, safe), Math.max(0, count.value - 1))
}

// Paging writes this at once and reports it, so two page turns inside one render still turn two
// pages; the host's own moves come back through the model.
const current = ref(clampIndex(index.value))
const currentItem = computed(() => items.value[current.value] ?? null)

function setCurrent(value: number): void {
  current.value = value
  index.value = value
}

const bounce = computed(() => (Number.isFinite(props.bounce) ? Math.min(0.9, Math.max(0, props.bounce)) : 0.2))

const maskMaterial = computed(() => ({
  mode: props.maskSurface,
  color: props.maskColor,
  opacity: props.maskOpacity,
  blur: props.maskBlur,
}))

const controlMaterial = computed(() => ({
  mode: props.controlSurface,
  color: props.controlColor,
  opacity: props.controlOpacity,
  blur: props.controlBlur,
}))

// -- The stage. The fit box is an invisible element the stylesheet places, so the room the
// chrome takes, the safe areas and the phone layout are all CSS; this only reads it back.

const overlayRef = ref<HTMLElement | null>(null)
const stageRef = ref<HTMLElement | null>(null)
const fitRef = ref<HTMLElement | null>(null)
const stageSize = shallowRef<PreviewSize>({ width: 0, height: 0 })
const fitBox = shallowRef<PreviewBox>({ x: 0, y: 0, width: 0, height: 0 })
let resizeObserver: ResizeObserver | undefined

function measure(): void {
  const stage = stageRef.value
  const fit = fitRef.value
  if (!stage || !fit)
    return
  const size = stageSize.value
  if (size.width !== stage.clientWidth || size.height !== stage.clientHeight)
    stageSize.value = { width: stage.clientWidth, height: stage.clientHeight }
  const box = fitBox.value
  if (box.x !== fit.offsetLeft || box.y !== fit.offsetTop || box.width !== fit.offsetWidth || box.height !== fit.offsetHeight)
    fitBox.value = { x: fit.offsetLeft, y: fit.offsetTop, width: fit.offsetWidth, height: fit.offsetHeight }
}

watch(stageRef, (stage) => {
  resizeObserver?.disconnect()
  resizeObserver = undefined
  if (!stage)
    return
  measure()
  if (typeof ResizeObserver === 'undefined')
    return
  resizeObserver = new ResizeObserver(measure)
  resizeObserver.observe(stage)
  if (fitRef.value)
    resizeObserver.observe(fitRef.value)
}, { flush: 'post' })

/** A point in the overlay's pixels, which are the stage's. */
function overlayPoint(event: { clientX: number, clientY: number }): PreviewPoint {
  const rect = overlayRef.value?.getBoundingClientRect()
  return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
}

// -- Pictures, use-preview-pictures': their sizes once loaded, the failed ones, and the stand-ins.

const {
  sizes,
  standIns,
  skeletonShown,
  isFailed,
  isLoaded,
  shapeOf,
  sizeOf,
  markLoaded,
  onImageLoad,
  onImageError,
  bindImage,
  adoptOrigin,
  clearStandIns,
  armSkeleton,
  clearSkeletonTimer,
} = usePreviewPictures({
  items: () => items.value,
  current,
  hostFailed: () => props.failed,
  fitBox: () => fitBox.value,
  onError: (url, at) => emit('error', url, at),
})

// -- Origins. The host says where a picture sits on the page. It flies out of there on opening
// and back on closing, and the thumbnail it left stays hidden while it is in the air.

/** Where picture `at` sits, in the stage's pixels, if the preview may fly it there: asked for, and in view. */
function zoomOrigin(at: number): PreviewOrigin | null {
  if (props.transition !== 'zoom' || reduced.value || !props.origin || !hasDocument())
    return null
  const origin = resolveOrigin(props.origin(at))
  if (!origin || !isOriginInView(origin, { width: window.innerWidth, height: window.innerHeight }))
    return null
  const root = overlayRef.value?.getBoundingClientRect()
  if (root && (root.left || root.top)) {
    origin.box = { ...origin.box, x: origin.box.x - root.left, y: origin.box.y - root.top }
    if (origin.clip)
      origin.clip = { ...origin.clip, x: origin.clip.x - root.left, y: origin.clip.y - root.top }
  }
  return origin
}

let hiddenOrigin: { element: HTMLElement, opacity: string, transition: string } | null = null

function hideOrigin(origin: PreviewOrigin): void {
  const element = origin.element
  if (hiddenOrigin?.element === element)
    return
  showOrigin()
  if (!element)
    return
  hiddenOrigin = { element, opacity: element.style.opacity, transition: element.style.transition }
  element.style.transition = 'none'
  element.style.opacity = '0'
}

function showOrigin(): void {
  const saved = hiddenOrigin
  hiddenOrigin = null
  if (!saved)
    return
  const { element } = saved
  element.style.opacity = saved.opacity
  // Back at once: a fade of its own would show the page through where the picture landed.
  void getComputedStyle(element).opacity
  element.style.transition = saved.transition
}

// -- Coming and going.

const transition = usePreviewTransition({ bounce: () => bounce.value })

/** A picture flying between its thumbnail and the stage. */
interface Flight {
  index: number
  /** In its thumbnail: where it flies out of, and home to. */
  from: FlightPose
  /** Where it leaves the stage from on the way home; flying out, it lands on its fit, which follows the stage. */
  to: FlightPose | null
  /** The size it is drawn at the whole way. */
  size: PreviewSize
}

const flight = shallowRef<Flight | null>(null)
const rendered = ref(false)
const closing = ref(false)
/** The preview has begun to come in; a flight first waits a moment for its picture. */
const arrived = ref(false)
// A touch tap hides the chrome, so the picture can be seen whole.
const chromeHidden = ref(false)
const zIndex = ref(zIndexAllocator.get())
let previouslyFocused: HTMLElement | null = null
/** Every opening and closing bumps it, so an opening still waiting for its picture gives up. */
let openToken = 0
/** How fast a drag threw the picture away (px/s), for its flight home. */
let pendingVelocity: [number, number] | null = null
/** How long an opening waits for its picture before it fades in instead (ms). */
const PICTURE_WAIT_MS = 150
/** How far a closing drag shrinks the picture, at its furthest. */
const DISMISS_SHRINK = 0.25

// A zoomed or turned picture paged away from keeps its view while it slides out of sight: the
// page turns halfway through the slide, with the picture still in view.
const outgoing = shallowRef<{ index: number, view: PreviewView, turns: number, angle: number } | null>(null)

const PICTURE = '.tx-image-preview__image, .tx-image-preview__stand-in, .tx-image-preview__frame, .tx-image-preview__placeholder, .tx-image-preview__failed'

function isPicture(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(PICTURE) !== null
}

// -- Actions, use-preview-actions', in the toolbar and the menu, which is use-preview-menu's.

const { actionList, actionLabel, actionDisabled, runAction, statusText, statusLevel, clearStatus } = usePreviewActions(props, {
  item: () => currentItem.value,
  index: () => current.value,
  isFailed,
  sizes: () => sizes.value,
  canRotate: () => gestures.view.value !== null,
  rotate: direction => gestures.rotate(direction),
  live: () => rendered.value && !closing.value,
  emit: event => emit('action', event),
  level: transition.level,
})

const {
  menuOpen,
  menuArmed,
  menuPlaced,
  menuRef,
  menuStyle,
  menuLevel,
  openMenu,
  closeMenu,
  chooseFromMenu,
  openMenuFromKeyboard,
  onContextMenu,
  onMouseDown,
  onMenuKey,
} = usePreviewMenu({
  enabled: () => props.contextMenu,
  live: () => rendered.value && !closing.value,
  overlay: overlayRef,
  actions: () => actionList.value,
  disabled: actionDisabled,
  run: runAction,
  fitBox: () => fitBox.value,
  isPicture,
  point: overlayPoint,
  settle: () => settleOpen(),
  endPress: () => gestures.endPress(),
  level: transition.level,
})
const menuRendered = computed(() => rendered.value && (menuOpen.value || menuLevel.value > 0))

const gestures = usePreviewGestures({
  stage: stageRef,
  size: () => stageSize.value,
  box: () => fitBox.value,
  image: () => {
    const item = currentItem.value
    return item && !isFailed(item.url) ? sizes.value.get(item.url) ?? null : null
  },
  maxScale: () => (Number.isFinite(props.maxScale) && props.maxScale > 0 ? props.maxScale : 4),
  active: () => rendered.value && !closing.value && !menuOpen.value,
  canStep: step => current.value + step >= 0 && current.value + step < count.value,
  onStep: (step) => {
    settleOpen()
    const view = gestures.view.value
    const turns = gestures.turns.value
    outgoing.value = view && gestures.moving.value && (gestures.zoomed.value || turns % 4 !== 0)
      ? { index: current.value, view, turns, angle: gestures.angle.value }
      : null
    setCurrent(clampIndex(current.value + step))
    gestures.resetView()
  },
  onDismiss: velocity => requestClose(velocity),
  isPicture,
  onBackdrop: () => {
    requestClose()
  },
  onTap: () => {
    chromeHidden.value = !chromeHidden.value
    // A hidden button that held focus would drop it to <body>, outside the dialog.
    const root = overlayRef.value
    if (chromeHidden.value && root && hasDocument() && root.contains(document.activeElement) && document.activeElement !== root)
      root.focus({ preventScroll: true })
  },
  onLongPress: point => openMenu(point, 'touch', true),
  bounce: () => bounce.value,
})

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

const dismissing = computed(() => gestures.gesture.value === 'dismiss' || gestures.dismissProgress.value > 0)
const chromeWanted = computed(() => rendered.value && arrived.value && !closing.value && !chromeHidden.value && !dismissing.value)
const chromeLevel = transition.level(() => chromeWanted.value, 180)
// The mask comes and goes with the picture, and thins out as a drag pulls the picture away.
const maskLevel = computed(() => clamp01(transition.presence.value) * (1 - gestures.dismissProgress.value))
// A fade carries the pictures in and out; a flight carries itself.
const stageLevel = computed(() => (!arrived.value ? 0 : transition.kind.value === 'fade' ? clamp01(transition.presence.value) : 1))

/** A hand reaching for the picture flying out lands it at once. */
function settleOpen(): void {
  if (flight.value && !closing.value)
    transition.finish()
}

/** The flight out has landed: the thumbnail shows again, under the mask. */
function landed(): void {
  flight.value = null
  showOrigin()
}

/** Waits up to `ms` for the current picture to be ready to draw, so a flight never starts empty. */
function pictureReady(ms: number): Promise<void> {
  const image = stageRef.value?.querySelector<HTMLImageElement>('.tx-image-preview__slide:not([aria-hidden]) .tx-image-preview__image')
  if (!image || typeof image.decode !== 'function')
    return Promise.resolve()
  return Promise.race([
    image.decode().catch(() => {}),
    new Promise<void>(resolve => setTimeout(resolve, ms)),
  ]).then(() => {
    if (image.complete && image.naturalWidth > 0)
      markLoaded(image)
  })
}

async function startOpen(token: number): Promise<void> {
  const at = current.value
  const item = items.value[at]
  const origin = item && !isFailed(item.url) ? zoomOrigin(at) : null
  if (item && origin) {
    adoptOrigin(item, origin)
    if (!standIns.value.has(item.url)) {
      await pictureReady(PICTURE_WAIT_MS)
      if (token !== openToken)
        return
    }
  }
  arrived.value = true
  const size = item ? sizes.value.get(item.url) ?? standIns.value.get(item.url)?.size : undefined
  if (!item || !origin || !size || isFailed(item.url) || current.value !== at) {
    transition.enter('fade')
    return
  }
  flight.value = { index: at, from: originPose(size, origin), to: null, size }
  hideOrigin(origin)
  transition.enter('zoom', landed)
}

function enter(): void {
  if (count.value === 0) {
    open.value = false
    return
  }
  const root = overlayRef.value
  if (hasDocument() && !(root && root.contains(document.activeElement)))
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
  zIndex.value = zIndexAllocator.next()
  current.value = clampIndex(current.value)
  const reopening = rendered.value && closing.value
  closing.value = false
  chromeHidden.value = false
  closeMenu(false)
  const token = ++openToken
  const shown = flight.value
  if (reopening && shown?.index === current.value && transition.kind.value === 'zoom') {
    // Opened again on its way home: it turns round and flies back out, landing on its fit.
    gestures.resetAll()
    flight.value = { ...shown, to: null }
    transition.enter('zoom', landed)
  }
  else if (reopening && !shown && transition.kind.value === 'fade') {
    gestures.resetAll()
    transition.enter('fade')
  }
  else {
    showOrigin()
    flight.value = null
    transition.reset()
    gestures.resetAll()
    arrived.value = false
    if (!rendered.value) {
      rendered.value = true
      armSkeleton()
    }
    nextTick(() => {
      if (token === openToken)
        void startOpen(token)
    })
  }
  nextTick(() => {
    overlayRef.value?.focus({ preventScroll: true })
  })
}

function restoreFocus(): void {
  const target = previouslyFocused
  previouslyFocused = null
  if (target?.isConnected)
    target.focus({ preventScroll: true })
}

function orient(size: PreviewSize, turns: number): PreviewSize {
  return Math.abs(turns) % 2 === 1 ? { width: size.height, height: size.width } : size
}

/** The current picture as drawn now, with its slide's shift and a closing drag's pull. */
function drawnPose(size: PreviewSize): FlightPose {
  const oriented = orient(size, gestures.turns.value)
  const view = gestures.view.value ?? fitView(oriented, fitBox.value)
  const { x, y } = gestures.dismiss.value
  return viewPose(view, oriented, gestures.angle.value, stageSize.value, {
    x: gestures.track.value + x,
    y,
    scale: 1 - gestures.dismissProgress.value * DISMISS_SHRINK,
  })
}

/** A throw's speed (px/s) as the flight home's (progress/s): its share along the way there. */
function flightSpeed(velocity: [number, number] | null, from: FlightPose, to: FlightPose): number | undefined {
  if (!velocity)
    return undefined
  const dx = to.x - from.x
  const dy = to.y - from.y
  const distance = dx * dx + dy * dy
  if (distance < 1)
    return 0
  return Math.min(0.5, Math.max(-10, (velocity[0] * dx + velocity[1] * dy) / distance))
}

type Leaving =
  | { kind: 'turn' }
  | { kind: 'home', origin: PreviewOrigin, size: PreviewSize }
  | { kind: 'fade' }

/** How the preview would go now: back the way a flight still coming in came, home from where the picture is drawn, or a fade. */
function leaving(): Leaving {
  if (flight.value && transition.kind.value === 'zoom')
    return { kind: 'turn' }
  if (transition.running.value || transition.presence.value !== 1)
    return { kind: 'fade' }
  const item = currentItem.value
  const size = item && !isFailed(item.url) ? sizes.value.get(item.url) ?? standIns.value.get(item.url)?.size : undefined
  const origin = size ? zoomOrigin(current.value) : null
  return origin && size ? { kind: 'home', origin, size } : { kind: 'fade' }
}

function finishLeave(): void {
  showOrigin()
  flight.value = null
  rendered.value = false
  closing.value = false
  arrived.value = false
  clearSkeletonTimer()
  gestures.resetAll()
  transition.reset()
  clearStandIns()
  clearStatus()
}

function leave(): void {
  if (!rendered.value || closing.value)
    return
  const plan = leaving()
  openToken++
  const velocity = pendingVelocity
  pendingVelocity = null
  gestures.cancel()
  closeMenu(false)
  closing.value = true
  restoreFocus()
  if (plan.kind === 'turn') {
    // Closed while still flying out: it turns round and goes home the way it came, keeping its speed.
    transition.leave('zoom', finishLeave)
    return
  }
  if (plan.kind === 'home') {
    // Home from where it is drawn: zoomed, turned, paged part-way or pulled down. The gestures
    // are left as they are, so a closing drag's fade carries on from where it was let go.
    const to = drawnPose(plan.size)
    const from = { ...originPose(plan.size, plan.origin), angle: uprightAngle(to.angle) }
    flight.value = { index: current.value, from, to, size: plan.size }
    hideOrigin(plan.origin)
    transition.leave('zoom', finishLeave, flightSpeed(velocity, from, to))
    return
  }
  // A picture thrown away keeps flying while everything fades; anything still held goes back.
  transition.leave('fade', finishLeave)
}

watch(open, (value) => {
  if (value)
    enter()
  else
    leave()
}, { immediate: true, flush: 'sync' })

/**
 * The person closed it: the close button, Escape, the backdrop, or a drag away (`velocity`, in
 * px/s). Returns whether the picture flies home, rather than gliding on as thrown.
 */
function requestClose(velocity?: [number, number]): boolean {
  if (!open.value)
    return false
  // Decided first: with a v-model the preview hears of the close a moment later.
  const flies = !closing.value && rendered.value && leaving().kind !== 'fade'
  pendingVelocity = velocity ?? null
  open.value = false
  emit('close')
  return flies
}

watch(index, (value) => {
  const next = clampIndex(value)
  if (next === current.value)
    return
  settleOpen()
  current.value = next
  gestures.resetAll()
})

// The list is the host's and can change under an open preview.
watch(count, (length) => {
  if (length === 0) {
    open.value = false
    return
  }
  const next = clampIndex(current.value)
  if (next !== current.value) {
    setCurrent(next)
    gestures.resetAll()
  }
})

// -- Drawing. A slide's picture sits in a frame, the window of it shown. At rest that is all of
// it, drawn at its view; in flight the frame is the thumbnail's crop, opening out on the way.

interface Slide {
  index: number
  offset: -1 | 0 | 1
  item: ImagePreviewItem
}

const slides = computed<Slide[]>(() => {
  const list: Slide[] = []
  for (const offset of [-1, 0, 1] as const) {
    const item = items.value[current.value + offset]
    if (item)
      list.push({ index: current.value + offset, offset, item })
  }
  return list
})

function restPose(slide: Slide, size: PreviewSize): FlightPose {
  const stage = stageSize.value
  if (slide.offset === 0) {
    const oriented = orient(size, gestures.turns.value)
    return viewPose(gestures.view.value ?? fitView(oriented, fitBox.value), oriented, gestures.angle.value, stage)
  }
  const frozen = outgoing.value?.index === slide.index ? outgoing.value : null
  if (frozen) {
    const oriented = orient(size, frozen.turns)
    return viewPose(frozen.view, oriented, frozen.angle, stage)
  }
  return viewPose(fitView(size, fitBox.value), size, 0, stage)
}

function slideStyle(slide: Slide): CSSProperties {
  const x = slide.offset * (stageSize.value.width + SLIDE_GAP) + gestures.track.value
  if (slide.offset !== 0)
    return { transform: `translate3d(${x}px, 0, 0)` }
  const { x: dx, y: dy } = gestures.dismiss.value
  const scale = 1 - gestures.dismissProgress.value * DISMISS_SHRINK
  return { transform: `translate3d(${x + dx}px, ${dy}px, 0) scale(${scale})` }
}

watch(gestures.moving, (moving) => {
  if (!moving)
    outgoing.value = null
})

const drawnSlides = computed(() => {
  const shown = flight.value
  const presence = transition.presence.value
  return slides.value.map((slide) => {
    const flying = shown?.index === slide.index
    const size = shown && flying ? shown.size : sizeOf(slide.item)
    // A flight lands on the fit as the stage has it now, so it follows a resize mid-air.
    const pose = shown && flying
      ? lerpPose(shown.from, shown.to ?? viewPose(fitView(size, fitBox.value), size, 0, stageSize.value), presence)
      : restPose(slide, size)
    const styles = poseStyles(pose, size)
    return {
      ...slide,
      key: `${slide.index}:${slide.item.url}`,
      flying,
      hidden: shown !== null && !flying,
      style: flying ? undefined : slideStyle(slide),
      frame: styles.frame,
      picture: styles.image,
      standIn: standIns.value.get(slide.item.url)?.src ?? null,
      loaded: isLoaded(slide.item.url),
      failed: isFailed(slide.item.url),
    }
  })
})

function placeholderStyle(slide: Slide): CSSProperties {
  const shape = shapeOf(slide.item)
  const view = fitView(shape, fitBox.value)
  return {
    width: `${shape.width * view.k}px`,
    height: `${shape.height * view.k}px`,
    transform: `translate3d(${view.tx}px, ${view.ty}px, 0)`,
  }
}

const boxStyle = computed<CSSProperties>(() => ({
  left: `${fitBox.value.x}px`,
  top: `${fitBox.value.y}px`,
  width: `${fitBox.value.width}px`,
  height: `${fitBox.value.height}px`,
}))

const dialogLabel = computed(() => (currentItem.value?.name ? props.labelFormatter(props.label, currentItem.value.name) : props.label))
const counterText = computed(() => props.counterFormatter(current.value + 1, count.value))
const readout = computed(() => (gestures.view.value ? props.scaleFormatter(gestures.view.value.k) : ''))
const readoutLabel = computed(() => (readout.value ? props.readoutLabelFormatter(readout.value, props.resetLabel) : props.resetLabel))
const canZoomOut = computed(() => gestures.view.value !== null && !gestures.atMinScale.value)
const canZoomIn = computed(() => gestures.view.value !== null && !gestures.atMaxScale.value)

// -- Controls. They stay focusable at the ends (aria-disabled): a disabled button that held
// focus would drop it to <body>, outside the dialog.

function step(direction: -1 | 1): void {
  if (current.value + direction >= 0 && current.value + direction < count.value)
    gestures.go(direction)
}

function zoomIn(): void {
  if (canZoomIn.value)
    gestures.zoomIn()
}

function zoomOut(): void {
  if (canZoomOut.value)
    gestures.zoomOut()
}

function resetZoom(): void {
  if (canZoomOut.value)
    gestures.resetZoom()
}

// -- The strip along the bottom, ImagePreviewStrip's: thumbnails or dots, following the pages.

const indicator = computed<ImagePreviewIndicator>(() => {
  if (count.value <= 1)
    return 'none'
  return props.indicator === 'dots' || props.indicator === 'none' ? props.indicator : 'thumbnails'
})

/** Where the pages are, in pictures: the current one, less the share of a page a slide has gone. */
const stripPosition = computed(() => {
  const width = stageSize.value.width + SLIDE_GAP
  const f = stageSize.value.width > 0 ? current.value - gestures.track.value / width : current.value
  return Math.min(Math.max(f, 0), Math.max(0, count.value - 1))
})

/** Shows picture `at` at once, with no slide. */
function showAt(at: number): void {
  if (!rendered.value || closing.value || at < 0 || at >= count.value)
    return
  settleOpen()
  setCurrent(at)
  gestures.resetAll()
}

function stepFromStrip(direction: 1 | -1): void {
  if (rendered.value && !closing.value)
    gestures.go(direction)
}

watch(current, () => closeMenu(false))

const overlayClass = computed(() => ({
  'is-closing': closing.value,
  'is-single': count.value <= 1,
  'is-zoomed': gestures.zoomed.value,
  'is-moving': gestures.moving.value || gestures.gesture.value !== 'idle',
  'is-grabbing': gestures.gesture.value === 'pan' || gestures.gesture.value === 'swipe',
  'is-dismissing': dismissing.value,
  'is-chrome-hidden': !chromeWanted.value,
  'is-chrome-off': chromeLevel.value === 0 && !chromeWanted.value,
  'is-flying': flight.value !== null,
  'is-menu-open': menuOpen.value,
  'has-thumbnails': indicator.value === 'thumbnails',
  'has-dots': indicator.value === 'dots',
  'has-strip': indicator.value !== 'none',
  'has-actions': actionList.value.length > 0,
}))

const overlayStyle = computed<CSSProperties>(() => ({
  'zIndex': zIndex.value,
  '--tx-image-preview-mask': `${maskLevel.value}`,
  '--tx-image-preview-stage': `${stageLevel.value}`,
  '--tx-image-preview-chrome': `${chromeLevel.value}`,
  '--tx-image-preview-menu': `${menuLevel.value}`,
  '--tx-image-preview-status': `${statusLevel.value}`,
  '--tx-image-preview-bounce-ease': `cubic-bezier(0.32, ${1 + bounce.value * 1.6}, 0.5, 1)`,
}))

// -- Keyboard. Tab stays inside the dialog: aria-modal promises the page behind is inert.

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]'
const PAGE_KEYS = new Set([' ', 'PageUp', 'PageDown', 'Home', 'End'])

/** What Tab reaches: not the strip's other thumbnails, nor chrome hidden or laid out of the way. */
function tabbable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el =>
    el.tabIndex >= 0 && (el.checkVisibility?.({ checkVisibilityCSS: true, visibilityProperty: true }) ?? true))
}

function trapFocus(event: KeyboardEvent): void {
  const root = overlayRef.value
  if (!root)
    return
  const focusable = tabbable(root)
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (!first || !last) {
    event.preventDefault()
    root.focus({ preventScroll: true })
    return
  }
  const active = document.activeElement
  if (event.shiftKey) {
    if (!root.contains(active) || active === first || active === root) {
      event.preventDefault()
      last.focus()
    }
  }
  else if (!root.contains(active) || active === root || active === last) {
    event.preventDefault()
    first.focus()
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (!rendered.value || closing.value || event.defaultPrevented)
    return
  if (!isTopmostModalDialog(overlayRef.value))
    return
  if (menuOpen.value) {
    onMenuKey(event)
    return
  }
  // A keyboard has nothing to tap the chrome back with.
  chromeHidden.value = false
  settleOpen()
  if (event.key === 'Tab') {
    trapFocus(event)
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    if (!gestures.cancel())
      requestClose()
    return
  }
  if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
    if (openMenuFromKeyboard())
      event.preventDefault()
    return
  }
  const plain = !event.ctrlKey && !event.metaKey && !event.altKey
  if ((event.key === 'r' || event.key === 'R') && plain && actionList.value.includes('rotate')) {
    event.preventDefault()
    runAction('rotate', event.shiftKey)
    return
  }
  if ((event.key === 'c' || event.key === 'C') && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && actionList.value.includes('copy')) {
    event.preventDefault()
    runAction('copy')
    return
  }
  if (gestures.onKey(event)) {
    event.preventDefault()
    return
  }
  // Nothing in the dialog scrolls, so these would scroll the page behind it; a button keeps
  // its Space.
  const onButton = event.target instanceof Element && event.target.closest('button') !== null
  if (PAGE_KEYS.has(event.key) && !(onButton && event.key === ' ') && plain)
    event.preventDefault()
}

function onWheel(event: WheelEvent): void {
  settleOpen()
  gestures.onWheel(event)
}

function onGestureStart(event: Event): void {
  settleOpen()
  gestures.onGestureStart(event)
}

// Safari's trackpad pinch: no template binding exists for these events.
watch(overlayRef, (root, old) => {
  old?.removeEventListener('gesturestart', onGestureStart)
  old?.removeEventListener('gesturechange', gestures.onGestureChange)
  old?.removeEventListener('gestureend', gestures.onGestureEnd)
  root?.addEventListener('gesturestart', onGestureStart)
  root?.addEventListener('gesturechange', gestures.onGestureChange)
  root?.addEventListener('gestureend', gestures.onGestureEnd)
}, { flush: 'post' })

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  resizeObserver?.disconnect()
  showOrigin()
  if (rendered.value && !closing.value)
    restoreFocus()
})

defineExpose({
  /** Opens the preview, at `index` when given. */
  show(at?: number): void {
    if (typeof at === 'number')
      setCurrent(clampIndex(at))
    open.value = true
  },
  /** Closes the preview without emitting `close`, which reports the person closing it. */
  close(): void {
    open.value = false
  },
  next: () => step(1),
  prev: () => step(-1),
  zoomIn,
  zoomOut,
  /** Back to the whole picture. */
  reset: resetZoom,
  /** Turns the picture a quarter clockwise, or back with `-1`, without emitting `action`. */
  rotate: (direction: 1 | -1 = 1): void => gestures.rotate(direction),
})
</script>

<template>
  <!-- The condition sits on the Teleport: a host that empties <body> under an open preview leaves
       its root without a parent, and swapping that root for the v-if's placeholder would throw. -->
  <Teleport v-if="rendered" to="body">
    <div
      ref="overlayRef"
      class="tx-image-preview"
      :class="overlayClass"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      :aria-label="dialogLabel"
      :aria-hidden="closing || undefined"
      :inert="closing || undefined"
      :style="overlayStyle"
      @pointerdown.capture="settleOpen"
      @mousedown="onMouseDown"
      @wheel="onWheel"
      @contextmenu="onContextMenu"
    >
      <TxBaseSurface class="tx-image-preview__backdrop tx-image-preview__surface" fake v-bind="maskMaterial" aria-hidden="true" />

      <div
        ref="stageRef"
        class="tx-image-preview__stage"
        @pointerdown="gestures.onPointerDown"
        @pointermove="gestures.onPointerMove"
        @pointerup="gestures.onPointerUp"
        @pointercancel="gestures.onPointerCancel"
        @lostpointercapture="gestures.onLostPointerCapture"
        @click="gestures.onClick"
        @dragstart.prevent
      >
        <div ref="fitRef" class="tx-image-preview__fit" aria-hidden="true" />
        <div
          v-for="slide in drawnSlides"
          :key="slide.key"
          class="tx-image-preview__slide"
          :class="{ 'is-flying': slide.flying, 'is-hidden': slide.hidden }"
          :style="slide.style"
          :aria-hidden="slide.offset !== 0 || undefined"
        >
          <div v-if="slide.failed" class="tx-image-preview__failed" :style="boxStyle">
            <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="m3 15 5-5 4 4 3-3 6 6" />
              <circle cx="9" cy="9" r="1.4" />
            </svg>
            <span>{{ failedText }}</span>
          </div>
          <template v-else>
            <span
              v-if="skeletonShown && !slide.loaded && !slide.standIn"
              class="tx-image-preview__placeholder"
              :style="placeholderStyle(slide)"
              aria-hidden="true"
            />
            <div class="tx-image-preview__frame" :style="slide.frame">
              <img
                v-if="slide.standIn"
                class="tx-image-preview__stand-in"
                :src="slide.standIn"
                alt=""
                aria-hidden="true"
                draggable="false"
                :style="slide.picture"
              >
              <img
                :ref="bindImage"
                class="tx-image-preview__image"
                :class="{ 'is-loaded': slide.loaded }"
                :src="slide.item.url"
                :alt="slide.item.alt ?? slide.item.name ?? ''"
                :style="slide.picture"
                draggable="false"
                decoding="async"
                @load="onImageLoad"
                @error="onImageError($event, slide.index)"
              >
            </div>
          </template>
        </div>
      </div>

      <div class="tx-image-preview__bar tx-image-preview__chrome">
        <div class="tx-image-preview__heading tx-image-preview__part" aria-live="polite" aria-atomic="true">
          <span v-if="currentItem?.name" class="tx-image-preview__name">{{ currentItem.name }}</span>
          <span v-if="count > 1" class="tx-image-preview__counter">{{ counterText }}</span>
        </div>
        <button type="button" class="tx-image-preview__button" :aria-label="closeLabel" @click="requestClose()">
          <TxBaseSurface class="tx-image-preview__surface tx-image-preview__control-surface" tag="span" fake v-bind="controlMaterial" />
          <svg class="tx-image-preview__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      <button
        v-if="count > 1"
        type="button"
        class="tx-image-preview__button tx-image-preview__nav tx-image-preview__chrome is-previous"
        :aria-label="previousLabel"
        :aria-disabled="current <= 0 || undefined"
        @click="step(-1)"
      >
        <TxBaseSurface class="tx-image-preview__surface tx-image-preview__control-surface" tag="span" fake v-bind="controlMaterial" />
        <svg class="tx-image-preview__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m15 6-6 6 6 6" />
        </svg>
      </button>

      <ImagePreviewStrip
        v-if="indicator !== 'none'"
        :kind="indicator"
        :items="items"
        :current="current"
        :position="stripPosition"
        :sizes="sizes"
        :failed="isFailed"
        :label="indicatorLabel"
        :formatter="indicatorItemFormatter"
        :material="controlMaterial"
        @show="showAt"
        @step="stepFromStrip"
      />

      <ImagePreviewToolbar
        :readout="readout"
        :readout-label="readoutLabel"
        :zoom-in-label="zoomInLabel"
        :zoom-out-label="zoomOutLabel"
        :can-zoom-in="canZoomIn"
        :can-zoom-out="canZoomOut"
        :actions="actionList"
        :action-label="actionLabel"
        :action-disabled="actionDisabled"
        :material="controlMaterial"
        @zoom-in="zoomIn"
        @zoom-out="zoomOut"
        @reset="resetZoom"
        @action="runAction"
      />

      <button
        v-if="count > 1"
        type="button"
        class="tx-image-preview__button tx-image-preview__nav tx-image-preview__chrome is-next"
        :aria-label="nextLabel"
        :aria-disabled="current >= count - 1 || undefined"
        @click="step(1)"
      >
        <TxBaseSurface class="tx-image-preview__surface tx-image-preview__control-surface" tag="span" fake v-bind="controlMaterial" />
        <svg class="tx-image-preview__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m9 6 6 6-6 6" />
        </svg>
      </button>

      <div class="tx-image-preview__status" role="status" aria-live="polite" aria-atomic="true">
        <div v-if="statusText" class="tx-image-preview__status-pill">
          <TxBaseSurface class="tx-image-preview__surface tx-image-preview__control-surface" fake v-bind="controlMaterial" />
          <span class="tx-image-preview__status-text tx-image-preview__part">{{ statusText }}</span>
        </div>
      </div>

      <div v-if="menuRendered" class="tx-image-preview__menu-layer" :class="{ 'is-armed': menuArmed }">
        <div class="tx-image-preview__scrim" aria-hidden="true" @pointerdown.prevent="closeMenu(true)" />
        <div
          ref="menuRef"
          class="tx-image-preview__menu"
          :class="{ 'is-open': menuOpen, 'is-placed': menuPlaced }"
          role="menu"
          :aria-label="menuLabel"
          :style="menuStyle"
        >
          <span class="tx-image-preview__menu-shadow tx-image-preview__part" aria-hidden="true" />
          <TxBaseSurface class="tx-image-preview__surface tx-image-preview__control-surface" fake v-bind="controlMaterial" />
          <button
            v-for="action in actionList"
            :key="action"
            type="button"
            role="menuitem"
            tabindex="-1"
            class="tx-image-preview__menu-item"
            :aria-disabled="actionDisabled(action) || undefined"
            @click="chooseFromMenu(action, $event.shiftKey)"
          >
            <span class="tx-image-preview__menu-text tx-image-preview__part">{{ actionLabel(action) }}</span>
            <svg class="tx-image-preview__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path v-for="d in ACTION_ICONS[action]" :key="d" :d="d" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style lang="scss">
@use '../../../style/mixins.scss' as *;

@include skeleton-keyframes;

// Teleported to <body>, so nothing here may be nested in a host's class. Always dark, as a
// photo viewer is, whatever the page's theme.

// A part fades with its container's level (`--tx-image-preview-level`, 0 to 1), from nothing up
// to the opacity it has at rest: its animation is held that far through, and at 1 is over and
// leaves the part be. Only parts fade, never what holds them: an ancestor with an opacity is a
// backdrop root, and every material inside it would blur nothing but that ancestor's own paint.
@keyframes tx-image-preview-part {
  from {
    opacity: 0;
  }
}

@mixin tx-image-preview-part {
  animation: tx-image-preview-part 1s linear paused;
  animation-delay: calc(var(--tx-image-preview-level, 1) * -1s);
}

.tx-image-preview {
  --tx-image-preview-ink: rgba(255, 255, 255, 0.94);
  --tx-image-preview-ink-muted: rgba(255, 255, 255, 0.6);
  --tx-image-preview-ink-disabled: rgba(255, 255, 255, 0.32);
  --tx-image-preview-tint-hover: rgba(255, 255, 255, 0.1);
  --tx-image-preview-tint-active: rgba(255, 255, 255, 0.18);
  // The wash the materials lay over what they blur: dark here, whatever the page's theme.
  --tx-bg-color-overlay: rgb(28, 28, 32);

  position: fixed;
  inset: 0;
  overflow: hidden;
  outline: none;
  color: var(--tx-image-preview-ink);
  font-size: 13px;
  // The preview owns every touch: no page pan, no pinch zoom, no double-tap zoom behind it.
  touch-action: none;
  overscroll-behavior: contain;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
}

// iOS Safari's fixed `inset: 0` follows the largest viewport, so the toolbar slid under the
// browser's own; the dynamic viewport is the part actually showing.
@supports (height: 100dvh) {
  .tx-image-preview {
    bottom: auto;
    height: 100dvh;
  }
}

// -- Levels: each container hands its parts the level they fade with.

.tx-image-preview__backdrop {
  --tx-image-preview-level: var(--tx-image-preview-mask, 1);
}

.tx-image-preview__chrome {
  --tx-image-preview-level: var(--tx-image-preview-chrome, 1);
}

.tx-image-preview__menu-layer {
  --tx-image-preview-level: var(--tx-image-preview-menu, 1);
}

.tx-image-preview__status {
  --tx-image-preview-level: var(--tx-image-preview-status, 1);
}

.tx-image-preview__part,
.tx-image-preview__icon,
.tx-image-preview__bar::before,
.tx-image-preview__button::after,
.tx-image-preview__menu-item::after,
.tx-image-preview__surface::before,
.tx-image-preview__surface > .tx-base-surface__layer {
  @include tx-image-preview-part;
}

// A high-contrast surface is one solid fill with no material to blind, and fades whole.
.tx-image-preview__surface {
  @include tx-when-high-contrast {
    @include tx-image-preview-part;
  }
}

// -- Materials. The mask behind the picture, and each control's, fill their holder from behind.

.tx-image-preview__backdrop.tx-image-preview__backdrop {
  position: absolute;
  inset: 0;
  z-index: 0;
  border-radius: 0;
}

.tx-image-preview__control-surface.tx-image-preview__control-surface {
  position: absolute;
  inset: 0;
  z-index: 0;
  border-radius: inherit;
  pointer-events: none;
}

// -- The stage.

.tx-image-preview__stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
  opacity: var(--tx-image-preview-stage, 1);
  transform: scale(calc(0.96 + 0.04 * var(--tx-image-preview-stage, 1)));
}

// Where a whole picture fits: clear of the top bar, the side buttons, the strip and the toolbar.
.tx-image-preview__fit {
  position: absolute;
  inset: 64px 88px 96px;
  visibility: hidden;
  pointer-events: none;
}

.tx-image-preview.is-single .tx-image-preview__fit {
  right: 24px;
  left: 24px;
}

.tx-image-preview.has-thumbnails .tx-image-preview__fit {
  bottom: 144px;
}

.tx-image-preview.has-dots .tx-image-preview__fit {
  bottom: 120px;
}

.tx-image-preview__slide {
  position: absolute;
  inset: 0;
}

// The neighbours wait out of sight while a picture flies in or out.
.tx-image-preview__slide.is-hidden {
  visibility: hidden;
}

// The window of the picture shown: all of it at rest; in flight, as much as its thumbnail
// shows, with the thumbnail's corners.
.tx-image-preview__frame {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
}

.tx-image-preview__slide.is-flying .tx-image-preview__frame {
  overflow: hidden;
}

.tx-image-preview__image,
.tx-image-preview__stand-in {
  position: absolute;
  top: 0;
  left: 0;
  max-width: none;
  max-height: none;
  -webkit-user-drag: none;
}

.tx-image-preview__stand-in {
  object-fit: cover;
}

.tx-image-preview__image {
  opacity: 0;
  cursor: zoom-in;
  transition: opacity 0.2s ease-out;
}

.tx-image-preview__image.is-loaded {
  opacity: 1;
}

// Composited only while something moves: a layer kept at rest stays rasterised at the scale it
// started at, and a picture zoomed into would stay blurred.
.tx-image-preview.is-moving .tx-image-preview__frame {
  will-change: transform;
}

.tx-image-preview.is-zoomed .tx-image-preview__image {
  cursor: grab;
}

.tx-image-preview.is-grabbing .tx-image-preview__stage,
.tx-image-preview.is-grabbing .tx-image-preview__image {
  cursor: grabbing;
}

.tx-image-preview__placeholder {
  --tx-skeleton-base-color: rgba(255, 255, 255, 0.16);

  position: absolute;
  top: 0;
  left: 0;
  border-radius: 6px;

  @include skeleton-surface;
}

.tx-image-preview__failed {
  position: absolute;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: var(--tx-image-preview-ink-muted);
  text-align: center;
}

// -- Chrome. Hidden, it lets the pointer through to the picture as it fades, and once gone it
// leaves the tab order.

.tx-image-preview.is-chrome-hidden .tx-image-preview__chrome,
.tx-image-preview.is-chrome-hidden .tx-image-preview__chrome * {
  pointer-events: none;
}

.tx-image-preview.is-chrome-off .tx-image-preview__chrome {
  visibility: hidden;
}

.tx-image-preview__bar {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  display: flex;
  gap: 12px;
  align-items: center;
  padding: calc(12px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right)) 12px calc(20px + env(safe-area-inset-left));
  // Drags that start beside the title reach the stage; only the controls catch the pointer.
  pointer-events: none;

  // A scrim for when a zoomed picture runs under the title.
  &::before {
    position: absolute;
    inset: 0 0 -28px;
    background: linear-gradient(rgba(0, 0, 0, 0.42), rgba(0, 0, 0, 0));
    content: '';
  }
}

.tx-image-preview__heading {
  position: relative;
  display: flex;
  flex: 1;
  gap: 10px;
  align-items: baseline;
  min-width: 0;
}

.tx-image-preview__name {
  overflow: hidden;
  font-size: 14px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tx-image-preview__counter {
  flex-shrink: 0;
  color: var(--tx-image-preview-ink-muted);
  font-variant-numeric: tabular-nums;
}

.tx-image-preview__button {
  position: relative;
  isolation: isolate;
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: none;
  border-radius: 999px;
  color: inherit;
  font: inherit;
  background: none;
  cursor: pointer;
  pointer-events: auto;
  transition:
    color 0.15s ease,
    transform 0.15s ease;

  // The tint a hover or a press lays over the material.
  &::after {
    position: absolute;
    inset: 0;
    z-index: 1;
    border-radius: inherit;
    background-color: transparent;
    content: '';
    pointer-events: none;
    transition: background-color 0.15s ease;
  }

  &:hover::after {
    background-color: var(--tx-image-preview-tint-hover);
  }

  &:active {
    transform: scale(0.94);
  }

  &:active::after {
    background-color: var(--tx-image-preview-tint-active);
  }

  &:focus-visible {
    outline: 2px solid var(--tx-image-preview-ink);
    outline-offset: 2px;
  }

  // Dimmed by its ink alone: an opacity of the button's own would blind the material inside it.
  &[aria-disabled='true'] {
    color: var(--tx-image-preview-ink-disabled);
    cursor: default;
    transform: none;

    &::after {
      background-color: transparent;
    }
  }

  @include tx-when-high-contrast {
    box-shadow: inset 0 0 0 1px var(--tx-image-preview-ink);
  }
}

.tx-image-preview__icon {
  position: relative;
  z-index: 2;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
}

.tx-image-preview__nav {
  position: absolute;
  top: 50%;
  width: 48px;
  height: 48px;
  margin-top: -24px;

  &.is-previous {
    left: calc(20px + env(safe-area-inset-left));
  }

  &.is-next {
    right: calc(20px + env(safe-area-inset-right));
  }
}

.tx-image-preview__toolbar {
  position: absolute;
  bottom: calc(24px + env(safe-area-inset-bottom));
  left: 50%;
  isolation: isolate;
  display: flex;
  gap: 2px;
  align-items: center;
  padding: 4px;
  border-radius: 999px;
  transform: translateX(-50%);

  .tx-image-preview__button {
    width: 36px;
    height: 36px;
  }
}

.tx-image-preview__zoom {
  display: flex;
  gap: 2px;
  align-items: center;
}

.tx-image-preview__divider {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: rgba(255, 255, 255, 0.16);
}

// The readout stays legible at fit, where it has nothing to reset.
.tx-image-preview__toolbar .tx-image-preview__readout {
  width: auto;
  min-width: 58px;
  padding: 0 8px;
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;

  &[aria-disabled='true'] {
    color: inherit;
  }
}

.tx-image-preview__readout-text {
  position: relative;
  z-index: 2;
}

// -- The strip. The thumbnails have no material behind them, so the strip fades as a whole.

.tx-image-preview__strip {
  position: absolute;
  bottom: calc(78px + env(safe-area-inset-bottom));
  left: 50%;
  width: min(calc(100% - 32px), 760px);
  height: 50px;
  overflow: hidden;
  opacity: var(--tx-image-preview-chrome, 1);
  transform: translateX(-50%);
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
}

.tx-image-preview__cell {
  position: absolute;
  top: 4px;
  left: 50%;
  box-sizing: border-box;
  height: 42px;
  padding: 0;
  overflow: hidden;
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  cursor: pointer;

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
    -webkit-user-drag: none;
  }

  &:focus-visible {
    outline: 2px solid var(--tx-image-preview-ink);
    outline-offset: 2px;
  }
}

.tx-image-preview__cell-failed {
  display: block;
  width: 100%;
  height: 100%;
  background: rgba(255, 255, 255, 0.12);
}

.tx-image-preview__cell.is-jumping {
  transition:
    transform 0.32s var(--tx-image-preview-bounce-ease),
    width 0.32s var(--tx-image-preview-bounce-ease),
    opacity 0.32s ease;
}

.tx-image-preview__dots {
  position: absolute;
  bottom: calc(82px + env(safe-area-inset-bottom));
  left: 50%;
  isolation: isolate;
  display: flex;
  align-items: center;
  height: 24px;
  padding: 0 6px;
  border-radius: 999px;
  transform: translateX(-50%);
}

.tx-image-preview__dot {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 24px;
  padding: 0 4px;
  border: none;
  border-radius: 999px;
  background: none;
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid var(--tx-image-preview-ink);
    outline-offset: -2px;
  }
}

.tx-image-preview__dot-mark {
  display: block;
  width: 6px;
  height: 6px;
  border-radius: 3px;
  background: var(--tx-image-preview-ink);
}

.tx-image-preview__dot-mark.is-jumping {
  transition:
    width 0.32s var(--tx-image-preview-bounce-ease),
    transform 0.32s var(--tx-image-preview-bounce-ease);
}

// -- The status.

.tx-image-preview__status {
  position: absolute;
  top: calc(64px + env(safe-area-inset-top));
  left: 50%;
  transform: translateX(-50%);
  pointer-events: none;
}

.tx-image-preview__status-pill {
  position: relative;
  isolation: isolate;
  padding: 8px 16px;
  border-radius: 999px;
  white-space: nowrap;
}

.tx-image-preview__status-text {
  position: relative;
  z-index: 1;
}

// -- The menu.

.tx-image-preview__menu-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

// Not until the press that opened it is let go, so the release picks nothing.
.tx-image-preview__menu-layer.is-armed {
  pointer-events: auto;
}

.tx-image-preview__scrim {
  position: absolute;
  inset: 0;
}

.tx-image-preview__menu {
  position: absolute;
  isolation: isolate;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: max-content;
  min-width: 196px;
  max-width: calc(100% - 16px);
  padding: 6px;
  border-radius: 14px;
  transform: scale(0.9);
  transition: transform 0.16s ease;
}

.tx-image-preview__menu:not(.is-placed) {
  visibility: hidden;
}

// It pops out of the press with the host's bounce.
.tx-image-preview__menu.is-open.is-placed {
  transform: none;
  transition: transform 0.36s var(--tx-image-preview-bounce-ease);
}

.tx-image-preview__menu-shadow {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow:
    6px 12px 40px rgba(0, 0, 0, 0.36),
    1px 2px 8px rgba(0, 0, 0, 0.2);
  pointer-events: none;
}

.tx-image-preview__menu-item {
  position: relative;
  isolation: isolate;
  display: flex;
  gap: 24px;
  align-items: center;
  justify-content: space-between;
  min-height: 40px;
  padding: 0 10px 0 12px;
  border: none;
  border-radius: 8px;
  outline: none;
  color: inherit;
  font: inherit;
  font-size: 14px;
  text-align: start;
  background: none;
  cursor: pointer;

  &::after {
    position: absolute;
    inset: 0;
    z-index: 1;
    border-radius: inherit;
    background-color: transparent;
    content: '';
    pointer-events: none;
  }

  &:hover::after,
  &:focus-visible::after {
    background-color: var(--tx-image-preview-tint-hover);
  }

  &:active::after {
    background-color: var(--tx-image-preview-tint-active);
  }

  &[aria-disabled='true'] {
    color: var(--tx-image-preview-ink-disabled);
    cursor: default;

    &::after {
      background-color: transparent;
    }
  }

  @include tx-when-high-contrast {
    &:focus-visible {
      outline: 2px solid var(--tx-image-preview-ink);
      outline-offset: -2px;
    }
  }
}

.tx-image-preview__menu-text {
  position: relative;
  z-index: 2;
}

// -- Phones, upright or on their side: the picture takes the whole screen, under the chrome,
// which a tap hides. Two fingers zoom, so the toolbar keeps only the actions, and the strip or
// the page buttons sit low, within a thumb's reach.
@media (max-width: 640px), (max-height: 480px) {
  .tx-image-preview__fit,
  .tx-image-preview.is-single .tx-image-preview__fit,
  .tx-image-preview.has-thumbnails .tx-image-preview__fit,
  .tx-image-preview.has-dots .tx-image-preview__fit {
    inset: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  }

  .tx-image-preview__bar {
    padding: calc(6px + env(safe-area-inset-top)) calc(8px + env(safe-area-inset-right)) 6px calc(16px + env(safe-area-inset-left));

    .tx-image-preview__button {
      width: 44px;
      height: 44px;
    }
  }

  .tx-image-preview__nav {
    top: auto;
    bottom: calc(12px + env(safe-area-inset-bottom));
    width: 44px;
    height: 44px;
    margin-top: 0;

    &.is-previous {
      left: calc(12px + env(safe-area-inset-left));
    }

    &.is-next {
      right: calc(12px + env(safe-area-inset-right));
    }
  }

  .tx-image-preview.has-strip .tx-image-preview__nav {
    display: none;
  }

  .tx-image-preview__toolbar {
    bottom: calc(12px + env(safe-area-inset-bottom));
    padding: 0;

    .tx-image-preview__button {
      width: 44px;
      height: 44px;
    }
  }

  .tx-image-preview__zoom,
  .tx-image-preview__divider {
    display: none;
  }

  .tx-image-preview:not(.has-actions) .tx-image-preview__toolbar {
    display: none;
  }

  .tx-image-preview__strip {
    bottom: calc(62px + env(safe-area-inset-bottom));
  }

  .tx-image-preview__dots {
    bottom: calc(66px + env(safe-area-inset-bottom));
  }

  .tx-image-preview:not(.has-actions) .tx-image-preview__strip {
    bottom: calc(8px + env(safe-area-inset-bottom));
  }

  .tx-image-preview:not(.has-actions) .tx-image-preview__dots {
    bottom: calc(12px + env(safe-area-inset-bottom));
  }
}

@media (prefers-reduced-motion: reduce) {
  .tx-image-preview__stage {
    transform: none;
  }

  .tx-image-preview__menu,
  .tx-image-preview__menu.is-open.is-placed {
    transform: none;
    transition: none;
  }
}
</style>
