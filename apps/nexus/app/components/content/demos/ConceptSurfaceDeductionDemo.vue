<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, triggerRef } from 'vue'
import ConceptFigure from './ConceptFigure.vue'

/**
 * A draggable card holding a real TxBaseSurface in refraction mode, whose `moving`
 * prop this figure drives from the pointer's speed.
 *
 * The policy is the figure's own: `moving` turns on the frame the speed exceeds
 * 1.2 px/ms and turns off once the speed has stayed below that for 140 ms. TxBaseSurface
 * measures no speed (its `autoDetect` watches inline transforms and CSS transitions);
 * what it does with `moving` comes from base-surface-motion.ts, and the timeline's
 * recovery band is computed from the same constants rather than read from the component.
 *
 * Frames run only while a drag or fling is in progress, while `moving` is set, or until
 * the recovery band has been drawn.
 */

type Phase = 'active' | 'fallback' | 'recovering'

interface Point {
  t: number
  x: number
  y: number
}

interface TimelineSample {
  t: number
  v: number
  phase: Phase
}

interface Fling {
  from: { x: number, y: number }
  to: { x: number, y: number }
  start: number
  duration: number
}

const { locale } = useI18n()

/** px/ms; the figure's threshold. */
const THRESHOLD = 1.2
/** How long the speed must stay under the threshold before `moving` clears. */
const HOLD_MS = 140
/** Speed is displacement over this window, so a pointer that stops reads 0 within it. */
const WINDOW_MS = 48
const SPAN_MS = 3000
const METER_MAX = 3
/** A fling starts at three times this average speed (ease-out cubic). */
const FLING_SPEED = 0.9
// TxBaseSurface's refraction recovery (base-surface-motion.ts), recomputed the way the
// component does: max(parameter blend, mask release delay + release duration).
const RECOVERY_MS = Math.max(Math.max(182, 299 * 0.35), 60 + Math.round(650 * 0.35))

// Timeline units.
const TL_W = 360
const TL_TOP = 6
const TL_BOTTOM = 62
const BAND_Y = 70
const BAND_H = 10

const copy = computed(() => locale.value === 'zh'
  ? {
      stage: '可拖动的琉光卡片：拖动它，或按“甩一下”',
      drag: '拖我',
      fling: '甩一下',
      speed: '指针速度',
      peak: '本次峰值',
      state: '状态',
      prop: '传给组件',
      timer: '计时',
      releaseIn: (ms: number) => `${ms} ms 后清除`,
      recovering: '组件恢复中',
      idle: '—',
      threshold: '阈值 1.2 px/ms',
      legendSpeed: '速度',
      legendFallback: 'Layered_Fallback（moving = true）',
      legendRecovery: `Refraction_Recovering（${RECOVERY_MS} ms）`,
      legendActive: 'Refraction_Active',
      timeline: (state: string, speed: string) => `最近 3 秒的指针速度与状态，当前 ${state}，速度 ${speed} px/ms`,
      caption: `拖动或甩动卡片：这张图按指针速度（${WINDOW_MS} ms 窗口）驱动 moving，超过 1.2 px/ms 立即置为 true，低于阈值满 140 ms 才清除。这是图自己的策略，TxBaseSurface 本身不测速度。时间轴上的恢复期（${RECOVERY_MS} ms）按组件常量推算。`,
    }
  : {
      stage: 'A draggable refraction card: drag it, or press Fling',
      drag: 'Drag me',
      fling: 'Fling',
      speed: 'Pointer speed',
      peak: 'Peak this gesture',
      state: 'State',
      prop: 'Passed to the component',
      timer: 'Timer',
      releaseIn: (ms: number) => `clears in ${ms} ms`,
      recovering: 'component recovering',
      idle: '—',
      threshold: 'Threshold 1.2 px/ms',
      legendSpeed: 'Speed',
      legendFallback: 'Layered_Fallback (moving = true)',
      legendRecovery: `Refraction_Recovering (${RECOVERY_MS} ms)`,
      legendActive: 'Refraction_Active',
      timeline: (state: string, speed: string) => `Pointer speed and state over the last 3 seconds; now ${state} at ${speed} px/ms`,
      caption: `Drag or fling the card. The figure drives moving from pointer speed over a ${WINDOW_MS} ms window: above 1.2 px/ms sets it at once, and it clears after 140 ms below. That policy is the figure's own; TxBaseSurface measures no speed. The timeline's recovery band (${RECOVERY_MS} ms) is computed from the component's constants.`,
    })

const stageRef = ref<HTMLElement | null>(null)
const cardRef = ref<HTMLElement | null>(null)
const position = ref({ x: 0, y: 0 })
const dragging = ref(false)
const moving = ref(false)
const recovering = ref(false)
const speed = ref(0)
const peak = ref(0)
const releaseLeft = ref<number | null>(null)
const timeline = shallowRef<TimelineSample[]>([])
const lastTime = ref(0)

let samples: Point[] = []
let releaseSince: number | null = null
let recoveringUntil = 0
let frame = 0
let pointerId: number | null = null
let stageRect: DOMRect | null = null
let grab = { x: 0, y: 0 }
let fling: Fling | null = null
let resizeObserver: ResizeObserver | null = null
/** Whether the card has been moved, so a resize clamps it instead of re-centring it. */
let placed = false

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function bounds() {
  const stage = stageRef.value
  const card = cardRef.value
  if (!stage || !card)
    return { maxX: 0, maxY: 0 }
  return {
    maxX: Math.max(0, stage.clientWidth - card.offsetWidth),
    maxY: Math.max(0, stage.clientHeight - card.offsetHeight),
  }
}

/** Event time on the performance.now() clock. */
function stamp(event: Event) {
  return event.timeStamp > 1e12 ? performance.now() : event.timeStamp
}

/** Displacement over the last WINDOW_MS, divided by it; the pointer rests at its last sample. */
function speedAt(t: number) {
  if (!samples.length)
    return 0
  const last = samples[samples.length - 1]!
  const from = t - WINDOW_MS
  let index = samples.length - 1
  while (index > 0 && samples[index - 1]!.t > from)
    index -= 1
  let x = samples[0]!.x
  let y = samples[0]!.y
  if (index > 0) {
    const a = samples[index - 1]!
    const b = samples[index]!
    const span = b.t - a.t
    const k = span > 0 ? clamp((from - a.t) / span, 0, 1) : 1
    x = a.x + (b.x - a.x) * k
    y = a.y + (b.y - a.y) * k
  }
  return Math.hypot(last.x - x, last.y - y) / WINDOW_MS
}

function record(t: number, v: number) {
  const list = timeline.value
  const previous = list[list.length - 1]
  // After an idle stretch the speed was 0 until now, not a ramp from the last sample.
  if (previous && t - previous.t > 100)
    list.push({ t: t - 16, v: 0, phase: 'active' })
  list.push({ t, v, phase: moving.value ? 'fallback' : recovering.value ? 'recovering' : 'active' })
  while (list.length && list[0]!.t < t - SPAN_MS)
    list.shift()
  lastTime.value = t
  triggerRef(timeline)
}

function stepFling(t: number) {
  const current = fling!
  const p = clamp((t - current.start) / current.duration, 0, 1)
  const eased = 1 - (1 - p) ** 3
  const x = current.from.x + (current.to.x - current.from.x) * eased
  const y = current.from.y + (current.to.y - current.from.y) * eased
  position.value = { x, y }
  samples.push({ t, x, y })
  if (p >= 1)
    fling = null
}

function tick() {
  frame = 0
  const t = performance.now()
  if (fling)
    stepFling(t)
  while (samples.length > 2 && samples[1]!.t < t - WINDOW_MS)
    samples.shift()

  const v = speedAt(t)
  speed.value = v
  if (dragging.value || fling)
    peak.value = Math.max(peak.value, v)

  if (v > THRESHOLD) {
    moving.value = true
    releaseSince = null
  }
  else if (moving.value) {
    if (releaseSince == null) {
      releaseSince = t
    }
    else if (t - releaseSince >= HOLD_MS) {
      moving.value = false
      releaseSince = null
      recoveringUntil = t + RECOVERY_MS
    }
  }
  recovering.value = !moving.value && t < recoveringUntil
  releaseLeft.value = releaseSince == null ? null : Math.max(0, Math.round(HOLD_MS - (t - releaseSince)))
  record(t, v)

  if (dragging.value || fling || moving.value || recovering.value)
    frame = requestAnimationFrame(tick)
}

function ensureFrame() {
  if (!frame)
    frame = requestAnimationFrame(tick)
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0 || !stageRef.value)
    return
  fling = null
  stageRect = stageRef.value.getBoundingClientRect()
  grab = {
    x: event.clientX - stageRect.left - position.value.x,
    y: event.clientY - stageRect.top - position.value.y,
  }
  pointerId = event.pointerId
  placed = true
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  dragging.value = true
  samples = [{ t: stamp(event), x: event.clientX, y: event.clientY }]
  peak.value = 0
  ensureFrame()
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value || event.pointerId !== pointerId || !stageRect)
    return
  const coalesced = event.getCoalescedEvents?.() ?? []
  for (const sample of coalesced.length ? coalesced : [event])
    samples.push({ t: stamp(sample), x: sample.clientX, y: sample.clientY })
  const { maxX, maxY } = bounds()
  position.value = {
    x: clamp(event.clientX - stageRect.left - grab.x, 0, maxX),
    y: clamp(event.clientY - stageRect.top - grab.y, 0, maxY),
  }
  ensureFrame()
}

function onPointerEnd(event: PointerEvent) {
  if (event.pointerId !== pointerId)
    return
  pointerId = null
  dragging.value = false
  ensureFrame()
}

function startFling() {
  const { maxX, maxY } = bounds()
  const from = { ...position.value }
  const to = { x: from.x < maxX / 2 ? maxX : 0, y: from.y < maxY / 2 ? maxY : 0 }
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  if (distance < 1)
    return
  pointerId = null
  dragging.value = false
  placed = true
  const start = performance.now()
  fling = { from, to, start, duration: clamp(distance / FLING_SPEED, 90, 420) }
  samples = [{ t: start, x: from.x, y: from.y }]
  peak.value = 0
  ensureFrame()
}

function centre() {
  const { maxX, maxY } = bounds()
  position.value = { x: maxX / 2, y: maxY / 2 }
}

const meterWidth = computed(() => `${(Math.min(speed.value, METER_MAX) / METER_MAX) * 100}%`)
const thresholdLeft = `${(THRESHOLD / METER_MAX) * 100}%`
const stateName = computed(() => (moving.value ? 'Layered_Fallback' : recovering.value ? 'Refraction_Recovering' : 'Refraction_Active'))
const stateNote = computed(() => {
  if (releaseLeft.value != null)
    return copy.value.releaseIn(releaseLeft.value)
  if (recovering.value)
    return copy.value.recovering
  return ''
})

function timelineX(t: number) {
  return TL_W * (1 - (lastTime.value - t) / SPAN_MS)
}

function timelineY(v: number) {
  return TL_BOTTOM - (Math.min(v, METER_MAX) / METER_MAX) * (TL_BOTTOM - TL_TOP)
}

const speedTrace = computed(() => timeline.value.map(sample => `${timelineX(sample.t).toFixed(1)},${timelineY(sample.v).toFixed(1)}`).join(' '))

const bands = computed(() => {
  const result: Array<{ x: number, width: number, phase: Phase }> = []
  const list = timeline.value
  list.forEach((sample, index) => {
    const x = timelineX(sample.t)
    const next = list[index + 1]
    const end = next ? timelineX(next.t) : x
    const last = result[result.length - 1]
    if (last && last.phase === sample.phase)
      last.width = end - last.x
    else
      result.push({ x, width: end - x, phase: sample.phase })
  })
  return result
})

function resetDemo() {
  if (frame)
    cancelAnimationFrame(frame)
  frame = 0
  fling = null
  pointerId = null
  samples = []
  releaseSince = null
  recoveringUntil = 0
  dragging.value = false
  moving.value = false
  recovering.value = false
  speed.value = 0
  peak.value = 0
  releaseLeft.value = null
  timeline.value = []
  placed = false
  centre()
}

onMounted(() => {
  centre()
  if (typeof ResizeObserver !== 'undefined' && stageRef.value) {
    resizeObserver = new ResizeObserver(() => {
      if (!placed) {
        centre()
        return
      }
      const { maxX, maxY } = bounds()
      position.value = { x: clamp(position.value.x, 0, maxX), y: clamp(position.value.y, 0, maxY) }
    })
    resizeObserver.observe(stageRef.value)
  }
})

onBeforeUnmount(() => {
  if (frame)
    cancelAnimationFrame(frame)
  frame = 0
  fling = null
  resizeObserver?.disconnect()
  resizeObserver = null
})

defineExpose({ resetDemo })
</script>

<template>
  <ConceptFigure class="sd-root" :caption="copy.caption">
    <div class="sd">
      <div ref="stageRef" class="sd-stage" role="group" :aria-label="copy.stage">
        <div class="sd-backdrop" aria-hidden="true">
          <span class="sd-blob is-1" />
          <span class="sd-blob is-2" />
          <span class="sd-blob is-3" />
          <span class="sd-word">Tuff</span>
        </div>
        <div
          ref="cardRef"
          class="sd-card"
          :class="{ 'is-dragging': dragging }"
          :style="{ transform: `translate(${position.x}px, ${position.y}px)` }"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerEnd"
          @pointercancel="onPointerEnd"
          @lostpointercapture="onPointerEnd"
        >
          <TxBaseSurface mode="refraction" :moving="moving" :radius="16" class="sd-surface">
            <span class="sd-surface__body">
              <span class="sd-surface__title">{{ copy.drag }}</span>
              <span class="sd-surface__state cfig-mono">moving = {{ moving }}</span>
            </span>
          </TxBaseSurface>
        </div>
      </div>

      <div class="sd-telemetry">
        <div
          class="sd-meter"
          role="meter"
          :aria-label="copy.speed"
          :aria-valuenow="Number(speed.toFixed(2))"
          aria-valuemin="0"
          :aria-valuemax="METER_MAX"
        >
          <span class="sd-meter__fill" :class="{ 'is-over': speed > THRESHOLD }" :style="{ width: meterWidth }" />
          <span class="sd-meter__threshold" :style="{ left: thresholdLeft }" />
        </div>
        <svg class="sd-timeline" :viewBox="`0 0 ${TL_W} ${BAND_Y + BAND_H + 2}`" preserveAspectRatio="none" role="img" :aria-label="copy.timeline(stateName, speed.toFixed(2))">
          <line class="sd-timeline__threshold" x1="0" :y1="timelineY(THRESHOLD)" :x2="TL_W" :y2="timelineY(THRESHOLD)" />
          <line class="sd-timeline__axis" x1="0" :y1="TL_BOTTOM" :x2="TL_W" :y2="TL_BOTTOM" />
          <rect
            v-for="(band, index) in bands"
            :key="index"
            class="sd-timeline__band"
            :class="`is-${band.phase}`"
            :x="band.x"
            :y="BAND_Y"
            :width="Math.max(0, band.width)"
            :height="BAND_H"
          />
          <polyline class="sd-timeline__speed" :points="speedTrace" />
        </svg>
      </div>
    </div>

    <template #controls>
      <TxButton size="sm" variant="secondary" @click="startFling">
        {{ copy.fling }}
      </TxButton>
      <div class="cfig-legend">
        <span class="cfig-legend__item" style="--swatch: var(--sd-speed)"><span class="cfig-legend__swatch" />{{ copy.legendSpeed }}</span>
        <span class="cfig-legend__item" style="--swatch: var(--sd-threshold)"><span class="cfig-legend__swatch" />{{ copy.threshold }}</span>
        <span class="cfig-legend__item" style="--swatch: var(--sd-active)"><span class="cfig-legend__swatch" />{{ copy.legendActive }}</span>
        <span class="cfig-legend__item" style="--swatch: var(--sd-fallback)"><span class="cfig-legend__swatch" />{{ copy.legendFallback }}</span>
        <span class="cfig-legend__item" style="--swatch: var(--sd-recovery)"><span class="cfig-legend__swatch" />{{ copy.legendRecovery }}</span>
      </div>
    </template>

    <template #readout>
      <span class="cfig-stat" :class="{ 'is-accent': speed > THRESHOLD }">
        <span class="cfig-stat__label">{{ copy.speed }}</span>
        <span class="cfig-stat__value">{{ speed.toFixed(2) }} px/ms</span>
      </span>
      <span class="cfig-stat">
        <span class="cfig-stat__label">{{ copy.peak }}</span>
        <span class="cfig-stat__value">{{ peak.toFixed(2) }} px/ms</span>
      </span>
      <span class="cfig-stat">
        <span class="cfig-stat__label">{{ copy.state }}</span>
        <span class="cfig-stat__value">{{ stateName }}</span>
      </span>
      <span class="cfig-stat">
        <span class="cfig-stat__label">{{ copy.prop }}</span>
        <span class="cfig-stat__value">moving = {{ moving }}</span>
      </span>
      <span class="cfig-stat">
        <span class="cfig-stat__label">{{ copy.timer }}</span>
        <span class="cfig-stat__value">{{ stateNote || copy.idle }}</span>
      </span>
    </template>
  </ConceptFigure>
</template>

<style scoped>
.sd-root {
  --sd-speed: var(--cfig-accent);
  --sd-threshold: var(--tx-color-warning, #e6a23c);
  --sd-active: color-mix(in srgb, var(--tx-color-success, #67c23a) 55%, transparent);
  --sd-fallback: color-mix(in srgb, var(--tx-color-danger, #f56c6c) 60%, transparent);
  --sd-recovery: color-mix(in srgb, var(--tx-color-warning, #e6a23c) 55%, transparent);
}

.sd {
  display: flex;
  flex-direction: column;
}

.sd-stage {
  position: relative;
  height: 230px;
  overflow: hidden;
  touch-action: none;
}

.sd-backdrop {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background:
    repeating-linear-gradient(90deg, rgb(255 255 255 / 0.28) 0 2px, transparent 2px 16px),
    linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%);
}

.sd-blob {
  position: absolute;
  border-radius: 50%;
  opacity: 0.6;
}

.sd-blob.is-1 {
  top: -40px;
  left: 6%;
  width: 160px;
  height: 160px;
  background: #ffd700;
}

.sd-blob.is-2 {
  right: 12%;
  bottom: -50px;
  width: 150px;
  height: 150px;
  background: #00d2ff;
}

.sd-blob.is-3 {
  top: 30px;
  right: -20px;
  width: 110px;
  height: 110px;
  background: #ff6b6b;
}

.sd-word {
  position: absolute;
  top: 50%;
  left: 50%;
  color: rgb(255 255 255 / 0.5);
  font-size: 72px;
  font-weight: 700;
  letter-spacing: 6px;
  transform: translate(-50%, -50%);
  user-select: none;
}

.sd-card {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
  width: 156px;
  height: 100px;
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.sd-card.is-dragging {
  cursor: grabbing;
}

.sd-surface {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--tx-text-color-primary, #303133);
}

.sd-surface__body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.sd-surface__title {
  font-size: 14px;
  font-weight: 600;
}

.sd-surface__state {
  font-size: 11px;
}

.sd-telemetry {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--cfig-line);
}

.sd-meter {
  position: relative;
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--cfig-ink) 8%, transparent);
}

.sd-meter__fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: var(--sd-speed);
}

.sd-meter__fill.is-over {
  background: var(--tx-color-danger, #f56c6c);
}

.sd-meter__threshold {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  background: var(--sd-threshold);
}

.sd-timeline {
  display: block;
  width: 100%;
  height: 84px;
}

.sd-timeline__axis {
  stroke: var(--cfig-line-strong);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.sd-timeline__threshold {
  stroke: var(--sd-threshold);
  stroke-width: 1;
  stroke-dasharray: 4 3;
  vector-effect: non-scaling-stroke;
}

.sd-timeline__speed {
  fill: none;
  stroke: var(--sd-speed);
  stroke-width: 1.6;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.sd-timeline__band.is-active {
  fill: var(--sd-active);
}

.sd-timeline__band.is-fallback {
  fill: var(--sd-fallback);
}

.sd-timeline__band.is-recovering {
  fill: var(--sd-recovery);
}
</style>
