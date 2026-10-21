import type { ComputedRef } from 'vue'
import type { BaseSurfaceMode } from './types'
import { computed, getCurrentScope, onBeforeUnmount, onMounted, onScopeDispose, readonly, ref, watch } from 'vue'
import { hasWindow } from '../../../../utils/env'

/** Pointer speed, in px/ms, above which a drag counts as fast motion. */
export const SURFACE_POINTER_SPEED_THRESHOLD = 1.2
/** How long an inferred motion signal has to stay quiet before it ends, in ms. */
export const SURFACE_MOTION_SETTLE_MS = 140
/** On battery power, the charge level at or below which surfaces save power (Windows' Battery Saver default). */
export const SURFACE_LOW_BATTERY_LEVEL = 0.2

/** The pointer speed is measured over at least this long, so one jittery event cannot trip it. */
const POINTER_SPEED_WINDOW_MS = 16
/** Frames sampled by one frame-budget probe: about half a second at 60 Hz. */
const FRAME_PROBE_FRAMES = 30
/** A probe stops sampling after this long even short of its frames; a throttled page is slow to fill it. */
const FRAME_PROBE_MAX_MS = 3000
/** Waits before re-probing a degraded page; a restore that janks again moves one step down the list. */
const FRAME_PROBE_RETRY_MS = [30_000, 60_000, 120_000, 300_000]
/** After a restore, the probe runs once more this soon, to catch jank the restored material causes. */
const FRAME_PROBE_CONFIRM_MS = 1500
/**
 * A median frame slower than this is the browser throttling the page (a window it treats
 * as idle gets a frame or so a second), not the page's cost: no material takes this long.
 */
const FRAME_THROTTLED_MS = 250

/**
 * How the frame-budget probe rates the page.
 * - `ok`: frames keep to the display's budget.
 * - `reduced`: a third or more of the frames overran one frame's budget (a dropped frame).
 * - `minimal`: the median frame overran two budgets.
 */
export type SurfaceFrameTier = 'ok' | 'reduced' | 'minimal'

/** A probe's reading: a tier, or `throttled` when the browser held the frames back. */
type SurfaceFrameReading = SurfaceFrameTier | 'throttled'

export interface SurfaceMotionGuardOptions {
  /** Quiet time before the motion ends, in ms; 140 by default. 0 ends it synchronously. */
  settleMs?: number
}

export interface SurfaceMotionGuard {
  /** Motion started: falls back at once, and cancels a pending end. */
  onMotionStart: () => void
  /** Motion stopped: recovers once nothing has started again for `settleMs`. */
  onMotionEnd: () => void
  /** Cancels a pending end. Called on its own when the guard was created inside an effect scope. */
  dispose: () => void
}

/**
 * The asymmetric clock behind every inferred motion signal: falling back takes 0ms,
 * recovering waits until the motion has been quiet for `settleMs`, so a gesture that
 * trembles around its threshold does not flip the material back and forth.
 *
 * `emitFallback` is called only when the state changes. Hosts that know when their
 * surface moves can drive `TxBaseSurface`'s `moving` prop through it.
 */
export function useSurfaceMotionGuard(
  emitFallback: (isFallback: boolean) => void,
  options: SurfaceMotionGuardOptions = {},
): SurfaceMotionGuard {
  const settleMs = Math.max(0, options.settleMs ?? SURFACE_MOTION_SETTLE_MS)
  let active = false
  let settleTimer: ReturnType<typeof setTimeout> | null = null

  function clearSettle() {
    if (settleTimer != null) {
      clearTimeout(settleTimer)
      settleTimer = null
    }
  }

  function onMotionStart() {
    clearSettle()
    if (!active) {
      active = true
      emitFallback(true)
    }
  }

  function onMotionEnd() {
    // A pending end keeps its deadline: quiet time is counted from the first stop.
    if (!active || settleTimer != null)
      return
    if (settleMs === 0) {
      active = false
      emitFallback(false)
      return
    }
    settleTimer = setTimeout(() => {
      settleTimer = null
      active = false
      emitFallback(false)
    }, settleMs)
  }

  if (getCurrentScope())
    onScopeDispose(clearSettle)

  return { onMotionStart, onMotionEnd, dispose: clearSettle }
}

// ---- Page-wide environment, shared by every surface with `autoDetect` ----

const pointerMoving = ref(false)
const windowMoving = ref(false)
const batteryLow = ref(false)
const powerSavingOverride = ref<boolean | null>(null)
const frameTier = ref<SurfaceFrameTier>('ok')
const powerSaving = computed(() => powerSavingOverride.value ?? batteryLow.value)

const pointerGuard = useSurfaceMotionGuard((value) => {
  pointerMoving.value = value
})
const windowGuard = useSurfaceMotionGuard((value) => {
  windowMoving.value = value
})

function pulse(guard: SurfaceMotionGuard) {
  guard.onMotionStart()
  guard.onMotionEnd()
}

/**
 * Reports that the window is moving or resizing. Surfaces with `autoDetect` treat the
 * window as moving until no report has arrived for 140ms.
 *
 * A page receives no event when its window moves, so the host forwards one: in Electron,
 * relay the `BrowserWindow`'s `move` (and `will-move`) events to the renderer and call this.
 * Resizes are picked up from the page's own `resize` event.
 */
export function notifySurfaceWindowMotion() {
  pulse(windowGuard)
}

/**
 * Overrides the power-saving signal: `true` or `false` from the host (in Electron,
 * `powerMonitor`'s battery events, say); `null` hands it back to the Battery Status API.
 */
export function setSurfacePowerSaving(value: boolean | null) {
  powerSavingOverride.value = value
}

/**
 * What surfaces may spend on their material. `max` gives every surface on the page, with
 * `autoDetect` or without, a solid fill in place of a material that samples the backdrop
 * (refraction, glass, acrylic, blur) or repaints with each scroll (mica). A surface over a system
 * backdrop keeps its material: the system draws it.
 */
export type SurfacePerformanceMode = 'default' | 'max'

const performanceMode = ref<SurfacePerformanceMode>('default')

/** Switches the page-wide performance mode; an app can bind it to a user setting. */
export function setSurfacePerformanceMode(mode: SurfacePerformanceMode) {
  performanceMode.value = mode === 'max' ? 'max' : 'default'
}

/** The current performance mode; reactive when read inside a computed or a render. */
export function getSurfacePerformanceMode(): SurfacePerformanceMode {
  return performanceMode.value
}

/** The material a surface renders under a performance mode. */
export function applySurfacePerformance(mode: BaseSurfaceMode, performance: SurfacePerformanceMode): BaseSurfaceMode {
  if (performance !== 'max')
    return mode
  const costly = mode === 'refraction' || mode === 'glass' || mode === 'acrylic' || mode === 'blur' || mode === 'mica'
  return costly ? 'flat' : mode
}

/** The environment as surfaces with `autoDetect` see it, read-only. */
export function getSurfaceEnvironment() {
  return {
    pointerMoving: readonly(pointerMoving),
    windowMoving: readonly(windowMoving),
    powerSaving: readonly(powerSaving),
    frameTier: readonly(frameTier),
    performanceMode: readonly(performanceMode),
  }
}

interface BatteryLike extends EventTarget {
  charging: boolean
  level: number
}

const pointerAnchors = new Map<number, { x: number, y: number, t: number }>()
let battery: BatteryLike | null = null
let subscribers = 0
let probeRaf: number | null = null
let probeTimer: ReturnType<typeof setTimeout> | null = null
let probeIdle: number | null = null
let probeBlocked = false
let probeRetryStep = 0
let confirmingRestore = false

function onPointerDown(event: PointerEvent) {
  pointerAnchors.set(event.pointerId, { x: event.clientX, y: event.clientY, t: event.timeStamp })
}

function onPointerMove(event: PointerEvent) {
  const anchor = pointerAnchors.get(event.pointerId)
  if (!anchor)
    return
  const dt = event.timeStamp - anchor.t
  if (dt < POINTER_SPEED_WINDOW_MS)
    return
  const speed = Math.hypot(event.clientX - anchor.x, event.clientY - anchor.y) / dt
  pointerAnchors.set(event.pointerId, { x: event.clientX, y: event.clientY, t: event.timeStamp })
  // A fast sample starts the motion and arms the end at once: the drag stays fast until
  // 140ms pass with no fast sample, which also ends it when the pointer is held still.
  if (speed > SURFACE_POINTER_SPEED_THRESHOLD)
    pulse(pointerGuard)
}

function onPointerEnd(event: PointerEvent) {
  pointerAnchors.delete(event.pointerId)
}

function onWindowBlur() {
  pointerAnchors.clear()
  // A window without focus may be throttled to a frame or two a second; what the probe
  // measured from here on would be the throttle, not the page.
  if (probeRaf != null) {
    cancelProbe()
    probeBlocked = true
  }
}

function onResize() {
  pulse(windowGuard)
}

function readBattery() {
  batteryLow.value = !!battery && !battery.charging && battery.level <= SURFACE_LOW_BATTERY_LEVEL
}

function attachBattery() {
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> }
  if (typeof nav.getBattery !== 'function')
    return
  nav.getBattery().then((manager) => {
    // The last surface may have gone while the promise was pending.
    if (!subscribers || battery)
      return
    battery = manager
    battery.addEventListener('chargingchange', readBattery)
    battery.addEventListener('levelchange', readBattery)
    readBattery()
  }, () => {})
}

function detachBattery() {
  if (!battery)
    return
  battery.removeEventListener('chargingchange', readBattery)
  battery.removeEventListener('levelchange', readBattery)
  battery = null
  batteryLow.value = false
}

/** Rates sampled frame intervals against the display's budget, which is unknown and estimated. */
export function classifySurfaceFrames(intervals: number[]): SurfaceFrameReading {
  if (!intervals.length)
    return 'ok'
  const sorted = [...intervals].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  if (median > FRAME_THROTTLED_MS)
    return 'throttled'
  // The shortest intervals are the frames that kept to the budget. Displays run at 60 Hz or
  // faster, so a page that drops every frame cannot pass its slow frames off as the budget.
  const budget = Math.min(sorted[Math.floor(sorted.length * 0.1)] ?? 0, 1000 / 60)
  if (median > budget * 2.5)
    return 'minimal'
  const overruns = intervals.filter(interval => interval > budget * 1.5).length
  return overruns * 3 >= intervals.length ? 'reduced' : 'ok'
}

function cancelProbe() {
  if (probeRaf != null) {
    cancelAnimationFrame(probeRaf)
    probeRaf = null
  }
  if (probeTimer != null) {
    clearTimeout(probeTimer)
    probeTimer = null
  }
  if (probeIdle != null && typeof cancelIdleCallback === 'function') {
    cancelIdleCallback(probeIdle)
  }
  probeIdle = null
}

function scheduleProbe(delayMs: number) {
  cancelProbe()
  probeTimer = setTimeout(() => {
    probeTimer = null
    // Wait for an idle moment, so the probe does not measure a page that is still mounting.
    if (typeof requestIdleCallback === 'function')
      probeIdle = requestIdleCallback(() => {
        probeIdle = null
        runProbe()
      }, { timeout: 1000 })
    else
      runProbe()
  }, delayMs)
}

/**
 * Whether the page's frames say anything about its cost. A hidden page gets none, and a
 * window without focus may be throttled to a frame or two a second, which would read as
 * a page in deep trouble.
 */
function canProbe() {
  return document.visibilityState === 'visible' && document.hasFocus()
}

function runProbe() {
  if (!subscribers || typeof requestAnimationFrame !== 'function')
    return
  // Probe again when the page is back in front.
  if (!canProbe()) {
    probeBlocked = true
    return
  }
  const stamps: number[] = []
  const tick = (timestamp: number) => {
    if (!canProbe()) {
      probeRaf = null
      probeBlocked = true
      return
    }
    stamps.push(timestamp)
    const firstStamp = stamps[0]
    if (firstStamp != null && stamps.length <= FRAME_PROBE_FRAMES && timestamp - firstStamp < FRAME_PROBE_MAX_MS) {
      probeRaf = requestAnimationFrame(tick)
      return
    }
    probeRaf = null
    applyFrameTier(classifySurfaceFrames(stamps.slice(1).map((stamp, index) => stamp - (stamps[index] ?? 0))))
  }
  probeRaf = requestAnimationFrame(tick)
}

function applyFrameTier(tier: SurfaceFrameReading) {
  if (tier === 'throttled') {
    // Nothing learnt: keep the tier, and measure again when the page comes back to the
    // front or after the usual wait, whichever is first.
    probeBlocked = true
    const retryDelay = FRAME_PROBE_RETRY_MS[probeRetryStep] ?? FRAME_PROBE_RETRY_MS[0] ?? 5000
    scheduleProbe(retryDelay)
    return
  }
  const wasDegraded = frameTier.value !== 'ok'
  frameTier.value = tier
  if (tier !== 'ok') {
    // Degraded, or a restore that janked again: wait longer each time before trying the material again.
    if (confirmingRestore)
      probeRetryStep = Math.min(probeRetryStep + 1, FRAME_PROBE_RETRY_MS.length - 1)
    confirmingRestore = false
    const retryDelay = FRAME_PROBE_RETRY_MS[probeRetryStep] ?? FRAME_PROBE_RETRY_MS[0] ?? 5000
    scheduleProbe(retryDelay)
    return
  }
  if (wasDegraded) {
    // Restored: the probe ran on the lighter material, so check once more on the heavier one.
    confirmingRestore = true
    scheduleProbe(FRAME_PROBE_CONFIRM_MS)
    return
  }
  confirmingRestore = false
  probeRetryStep = 0
}

/** On `visibilitychange` and window `focus`: runs the probe that the page's absence blocked. */
function onPageReturn() {
  if (probeBlocked && canProbe()) {
    probeBlocked = false
    scheduleProbe(0)
  }
}

const listenerOptions = { capture: true, passive: true } as const

function attach() {
  window.addEventListener('pointerdown', onPointerDown, listenerOptions)
  window.addEventListener('pointermove', onPointerMove, listenerOptions)
  window.addEventListener('pointerup', onPointerEnd, listenerOptions)
  window.addEventListener('pointercancel', onPointerEnd, listenerOptions)
  window.addEventListener('blur', onWindowBlur)
  window.addEventListener('focus', onPageReturn)
  window.addEventListener('resize', onResize, { passive: true })
  document.addEventListener('visibilitychange', onPageReturn)
  attachBattery()
  scheduleProbe(0)
}

function detach() {
  window.removeEventListener('pointerdown', onPointerDown, listenerOptions)
  window.removeEventListener('pointermove', onPointerMove, listenerOptions)
  window.removeEventListener('pointerup', onPointerEnd, listenerOptions)
  window.removeEventListener('pointercancel', onPointerEnd, listenerOptions)
  window.removeEventListener('blur', onWindowBlur)
  window.removeEventListener('focus', onPageReturn)
  window.removeEventListener('resize', onResize)
  document.removeEventListener('visibilitychange', onPageReturn)
  detachBattery()
  cancelProbe()
  pointerAnchors.clear()
  probeBlocked = false
  confirmingRestore = false
}

function subscribe() {
  subscribers += 1
  if (subscribers === 1)
    attach()
}

function unsubscribe() {
  subscribers = Math.max(0, subscribers - 1)
  if (subscribers === 0)
    detach()
}

export interface SurfaceEnvironment {
  /** A fast drag or a moving window, each held for 140ms after it stops. */
  moving: ComputedRef<boolean>
  powerSaving: ComputedRef<boolean>
  frameTier: ComputedRef<SurfaceFrameTier>
}

/**
 * Subscribes a mounted component to the page-wide environment while `enabled()` holds.
 * The listeners, the battery and the frame probe exist only while some component subscribes.
 */
export function useSurfaceEnvironment(enabled: () => boolean): SurfaceEnvironment {
  let mounted = false
  let subscribed = false

  function sync() {
    const want = mounted && enabled() && hasWindow()
    if (want && !subscribed) {
      subscribed = true
      subscribe()
    }
    else if (!want && subscribed) {
      subscribed = false
      unsubscribe()
    }
  }

  onMounted(() => {
    mounted = true
    sync()
  })
  watch(enabled, sync)
  onBeforeUnmount(() => {
    mounted = false
    sync()
  })

  return {
    moving: computed(() => enabled() && (pointerMoving.value || windowMoving.value)),
    powerSaving: computed(() => enabled() && powerSaving.value),
    frameTier: computed(() => (enabled() ? frameTier.value : 'ok')),
  }
}

/**
 * The material a surface renders in its environment: a power-saving device, or a page that
 * drops frames, swaps refraction, glass and acrylic for plain backdrop blur; a page whose
 * median frame overruns two budgets drops every backdrop material for a solid fill.
 */
export function degradeSurfaceMode(
  mode: BaseSurfaceMode,
  tier: SurfaceFrameTier,
  saving: boolean,
): BaseSurfaceMode {
  const samplesBackdrop = mode === 'refraction' || mode === 'glass' || mode === 'acrylic' || mode === 'blur'
  if (tier === 'minimal' && samplesBackdrop)
    return 'flat'
  if ((tier === 'reduced' || saving) && samplesBackdrop && mode !== 'blur')
    return 'blur'
  return mode
}
