<script setup lang="ts">
// SPDX-License-Identifier: Apache-2.0
// Modified: Vue/TuffEx port of Amicro dither-charts/DitherBook.tsx and simple-comp/SimpleCompExtracted.tsx.
// Source commit: 43c29ce9cdd16459e3eab4992381b8d35b38776a.
// Changes: caller-owned pages/slots, semantic controls, shared motion lifecycle, no external assets.
import type { CSSProperties } from 'vue'
import type { VelocityTracker } from '../../../../utils/gesture'
import type { FlipBookEmits, FlipBookProps, FlipBookSettings, FlipBookSlotProps } from './types'
import { computed, nextTick, onBeforeUnmount, onDeactivated, reactive, ref, watch } from 'vue'
import { stepSpring } from '../../../../utils/animation/spring'
import { createVelocityTracker, projectMomentum, rubberband } from '../../../../utils/gesture'
import { useMotionActivity } from '../../../../utils/motion-activity'
import { presets, resolveTransition } from '../../liquid/src/spring'
import { TxTextMorph } from '../../text-morph'

defineOptions({ name: 'TxFlipBook' })
const props = withDefaults(defineProps<FlipBookProps>(), {
  mode: 'dither-book', compact: false, loop: true, controls: true, settingsPanel: true,
  intro: false, introFlips: 10, animated: true, disabled: false, draggable: true, duration: 450,
  size: 'md', ariaLabel: 'Flip book',
})
const emit = defineEmits<FlipBookEmits>()
defineSlots<{ page?: (props: FlipBookSlotProps) => unknown, empty?: () => unknown }>()
const root = ref<HTMLElement | null>(null)
const leaf = ref<HTMLElement | null>(null)
const binding = ref<HTMLElement | null>(null)
const { active, reduced } = useMotionActivity(root, () => props.animated)
const localIndex = ref(props.modelValue ?? 0)
const displayedIndex = ref(0)
const direction = ref<1 | -1>(1)
const extracted = computed(() => props.mode === 'extracted-book')
const manualIntroLocked = computed(() => extracted.value && active.value && introRemaining.value > 0)
const flip = ref<{ from: number, to: number, direction: 1 | -1 } | null>(null)
const introRemaining = ref(props.intro ? props.introFlips : 0)
const introRunning = ref(false)
const settingsOpen = ref(false)
const animations: Animation[] = []
let introTimer: ReturnType<typeof setTimeout> | undefined
let animationVersion = 0
let mounted = true
let entrance: Animation | undefined
let entrancePlayed = false
const DRAG_SLOP = 4
// A release faster than this, in px/s, carried momentum: only then is the page's spring underdamped.
const FLICK = 100
// Near flat a little travel turns the page a long way; a release hands over at most this, in turns per second.
const MAX_TURN_SPEED = 8
const dragging = ref(false)
/** A turn drawn from script rather than the WAAPI curve: under the pointer, or released and settling. */
let turn: { progress: number, velocity: number, target?: 0 | 1, spring?: { stiffness: number, damping: number }, lift: boolean } | undefined
let turnFrame: number | undefined
let turnTime: number | undefined
let suppressClick = false
let drag: {
  pointerId: number
  x: number
  y: number
  moved: boolean
  /** The page's half of the binding and where its spine is drawn, read at grab time. */
  spine: number
  page: number
  /** The side grabbed at rest: 1 turns forwards, -1 backwards. */
  side: 1 | -1
  /** Turn progress expressed as horizontal travel, 0..1, when the drag began, and the travel a whole turn takes. */
  start: number
  span: number
  /** Where a turn grabbed in flight was heading, to carry on to if the drag is cancelled. */
  resume?: 0 | 1
  tracker: VelocityTracker
} | undefined
const settings = reactive<FlipBookSettings>({ padding: 10, imageRadius: 20, creaseOpacity: 11, paperColor: 'var(--tx-bg-color-overlay, var(--tx-bg-color))', shadowIntensity: 24 })
watch(() => [props.settings, props.padding, props.imageRadius, props.creaseOpacity, props.paperColor, props.shadowIntensity, props.compact, props.mode], () => {
  Object.assign(settings, {
    padding: props.padding ?? props.settings?.padding ?? (props.compact ? 6 : extracted.value ? 14 : 10),
    imageRadius: props.imageRadius ?? props.settings?.imageRadius ?? (props.compact ? 8 : extracted.value ? 32 : 20),
    creaseOpacity: props.creaseOpacity ?? props.settings?.creaseOpacity ?? 11,
    paperColor: props.paperColor ?? props.settings?.paperColor ?? 'var(--tx-bg-color-overlay, var(--tx-bg-color))',
    shadowIntensity: props.shadowIntensity ?? props.settings?.shadowIntensity ?? (props.compact ? 10 : extracted.value ? 34 : 24),
  })
}, { immediate: true, deep: true })
const copy = computed(() => ({
  previous: 'Previous', next: 'Next', settings: 'Book settings', padding: 'Image padding',
  imageRadius: 'Image radius', creaseOpacity: 'Crease opacity', paperColor: 'Paper color',
  shadowIntensity: 'Shadow intensity', intro: 'Replay opening', ...props.labels,
}))
const current = computed(() => normalize(props.modelValue ?? localIndex.value))
displayedIndex.value = current.value
const leftIndex = computed(() => flip.value ? (flip.value.direction === 1 ? flip.value.from - 1 : flip.value.to - 1) : displayedIndex.value - 1)
const rightIndex = computed(() => flip.value ? (flip.value.direction === 1 ? flip.value.to : flip.value.from) : displayedIndex.value)
const frontIndex = computed(() => flip.value?.direction === -1 ? flip.value.to : flip.value?.from ?? current.value)
const backIndex = computed(() => flip.value?.direction === -1 ? flip.value.from - 1 : (flip.value?.to ?? current.value) - 1)
const visiblePages = computed(() => [
  { index: leftIndex.value, side: 'left' as const, base: true },
  { index: rightIndex.value, side: 'right' as const, base: true },
])
const leafPages = computed(() => [
  { index: frontIndex.value, side: 'front' as const },
  { index: backIndex.value, side: 'back' as const },
])
const bookStyle = computed<CSSProperties>(() => ({
  '--tx-book-padding': `${settings.padding}px`, '--tx-book-radius': `${settings.imageRadius}px`,
  '--tx-book-crease': `${Math.max(0, Math.min(100, settings.creaseOpacity))}%`,
  '--tx-book-crease-soft': `${Math.max(0, Math.min(100, settings.creaseOpacity)) / 4}%`,
  '--tx-book-paper': settings.paperColor, '--tx-book-shadow': `${settings.shadowIntensity}px`,
  '--tx-book-crease-width': extracted.value ? '64px' : '48px',
  '--tx-book-pose': extracted.value ? 'rotateX(8deg) rotateY(-6deg)' : 'rotateX(6deg) rotateY(-4deg)',
  aspectRatio: extracted.value ? '16 / 9' : '16 / 10',
  perspective: extracted.value ? '3000px' : '2400px',
  maxWidth: `${({ xs: 300, sm: 400, md: 512, lg: 640 })[props.size]}px`,
}))
function normalize(index: number) {
  const count = props.pages.length
  if (!count || !Number.isFinite(index)) return 0
  const rounded = Math.round(index)
  return props.loop ? ((rounded % count) + count) % count : Math.max(0, Math.min(count - 1, rounded))
}
function pageAt(index: number) {
  if (!props.pages.length || (!props.loop && (index < 0 || index >= props.pages.length))) return undefined
  return props.pages[normalize(index)]
}
function clearIntroTimer() {
  if (introTimer !== undefined) { clearTimeout(introTimer); introTimer = undefined }
}
function cancelAnimations() {
  animationVersion++
  for (const animation of animations) { animation.onfinish = null; animation.cancel() }
  animations.length = 0
}
function finishFlip() {
  const state = flip.value
  if (!state) return
  cancelAnimations()
  // A released page ends where it was heading; one still held, where it was before the grab.
  const lift = turn?.lift ?? false
  const heading = turn ? turn.target ?? drag?.resume ?? 0 : 1
  const settled = lift || !heading ? state.from : state.to
  if (drag) endDrag()
  stopTurn()
  turn = undefined
  leaf.value?.style.removeProperty('transform')
  leaf.value?.querySelectorAll<HTMLElement>('.tx-flip-book__shade').forEach(shade => shade.style.removeProperty('opacity'))
  displayedIndex.value = settled
  flip.value = null
  if (!lift) emit('flip-end', settled)
  introRunning.value = false
  scheduleIntro()
}
async function animateFlip() {
  const version = ++animationVersion
  await nextTick()
  const state = flip.value
  if (!mounted || version !== animationVersion || !state) return
  const element = leaf.value
  if (!active.value || !element?.animate) { finishFlip(); return }
  const spring = resolveTransition('smooth')
  const fastIntro = introRunning.value && (extracted.value || introRemaining.value > 0)
  const duration = fastIntro ? (extracted.value ? 120 : 140) : props.duration
  const options: KeyframeAnimationOptions = { duration, easing: fastIntro ? 'linear' : spring.easing, fill: 'both' }
  const animation = element.animate([
    { transform: `rotateY(${state.direction === 1 ? 0 : -180}deg)` },
    { transform: `rotateY(${state.direction === 1 ? -180 : 0}deg)` },
  ], options)
  animations.push(animation)
  element.querySelectorAll<HTMLElement>('.tx-flip-book__shade').forEach((shade, index) => {
    const start = (state.direction === 1) === (index === 0) ? 0 : 0.4
    animations.push(shade.animate([{ opacity: start }, { opacity: 0.4 - start }], options))
  })
  animation.onfinish = () => { if (version === animationVersion) finishFlip() }
}
function startFlip(to: number, from: number) {
  if (flip.value) finishFlip()
  clearIntroTimer()
  const dir = to === normalize(from + direction.value) ? direction.value : to > from ? 1 : -1
  flip.value = { from: displayedIndex.value, to, direction: dir }
  emit('flip-start', displayedIndex.value, to, dir)
  if (!active.value) finishFlip()
  else void animateFlip()
}
watch(current, (to, from) => {
  if (to === displayedIndex.value && !flip.value) return
  // A released page is already turning towards the page it asked for.
  if (turn?.target !== undefined && to === (turn.target ? flip.value?.to : flip.value?.from)) return
  startFlip(to, from)
}, { flush: 'sync' })
watch(() => props.pages, () => {
  clearIntroTimer()
  if (flip.value) finishFlip()
  localIndex.value = normalize(localIndex.value)
  displayedIndex.value = current.value
}, { deep: true })
function goTo(index: number, requestedDirection?: 1 | -1) {
  if (props.disabled || flip.value || !props.pages.length || !Number.isFinite(index)) return
  const to = normalize(index)
  if (to === current.value) return
  direction.value = requestedDirection ?? (to > current.value ? 1 : -1)
  emit('update:modelValue', to)
  localIndex.value = to
  const page = props.pages[to]
  if (page) emit('change', page, to)
}
function previous() { if (manualIntroLocked.value) return; clearIntroTimer(); introRemaining.value = 0; goTo(current.value - 1, -1) }
function next() { if (manualIntroLocked.value) return; clearIntroTimer(); introRemaining.value = 0; goTo(current.value + 1, 1) }
function turnPage(side: 'left' | 'right', event: MouseEvent) {
  // A drag turns the page itself; the click it leaves behind is not another turn. Keyboard clicks have no detail.
  if (suppressClick && event.detail > 0) { suppressClick = false; return }
  if (side === 'left') previous()
  else next()
}
/** The WAAPI curve's spring, rescaled to `duration` like the curve; a release keeps its frequency. */
function releaseSpring(flick: boolean) {
  const omega = Math.sqrt(presets.smooth.stiffness / presets.smooth.mass) * resolveTransition('smooth').duration / props.duration
  return { stiffness: omega * omega, damping: 2 * (flick ? 0.8 : 1) * omega }
}
/** Progress 0..1 to the page's angle: a forward turn lifts it off the right, a backward one off the left. */
function paintTurn() {
  const element = leaf.value
  const state = flip.value
  if (!element || !state || !turn) return
  const lying = state.direction === 1 ? turn.progress : 1 - turn.progress
  element.style.transform = `rotateY(${-180 * lying}deg)`
  element.querySelectorAll<HTMLElement>('.tx-flip-book__shade').forEach((shade, index) => {
    shade.style.opacity = String(0.4 * (index === 0 ? lying : 1 - lying))
  })
}
/** How far a turn in flight has come, read from the angle the WAAPI curve is drawing. */
function drawnProgress(direction: 1 | -1) {
  const value = leaf.value ? getComputedStyle(leaf.value).transform : 'none'
  const matrix = value && value !== 'none' ? new DOMMatrix(value) : new DOMMatrix()
  const lying = Math.acos(Math.max(-1, Math.min(1, matrix.m11))) / Math.PI
  return direction === 1 ? lying : 1 - lying
}
function stopTurn() {
  if (turnFrame !== undefined) cancelAnimationFrame(turnFrame)
  turnFrame = undefined
  turnTime = undefined
}
function landTurn() {
  finishFlip()
  // A caller that kept its own page gets it back with an ordinary turn.
  if (current.value !== displayedIndex.value) startFlip(current.value, displayedIndex.value)
}
function stepTurn(time: number) {
  turnFrame = undefined
  const state = turn
  if (!state || state.target === undefined) return
  const dt = turnTime === undefined ? 1 / 60 : Math.min(0.1, Math.max(0, (time - turnTime) / 1000))
  turnTime = time
  const [progress, velocity] = stepSpring(state.progress, state.velocity, state.target, state.spring ?? releaseSpring(false), dt)
  // The page lands on the stack: it stops where it meets it instead of swinging through.
  if (Math.abs(progress - state.target) < 1e-3 || (state.target === 1 ? progress > 1 : progress < 0)) { landTurn(); return }
  state.progress = progress
  state.velocity = velocity
  paintTurn()
  turnFrame = requestAnimationFrame(stepTurn)
}
/** Sends a released page to `target`, emitting the page it lands on. */
function releaseTurn(target: 0 | 1, velocity: number, flick: boolean) {
  const state = flip.value
  if (!turn || !state) return
  turn.target = target
  turn.velocity = velocity
  turn.spring = releaseSpring(flick)
  const destination = target ? state.to : state.from
  if (!turn.lift && destination !== current.value) {
    direction.value = state.direction
    localIndex.value = destination
    emit('update:modelValue', destination)
    const page = props.pages[destination]
    if (page) emit('change', page, destination)
  }
  stopTurn()
  if (!active.value || !(props.duration > 0)) landTurn()
  else turnFrame = requestAnimationFrame(stepTurn)
}
function endDrag() {
  const state = drag
  drag = undefined
  dragging.value = false
  window.removeEventListener('keydown', onDragKeydown, true)
  if (state && binding.value?.hasPointerCapture(state.pointerId)) binding.value.releasePointerCapture(state.pointerId)
}
/** Escape, a cancelled pointer or lost capture: a fresh turn falls back, one grabbed in flight carries on. */
function cancelDrag() {
  const state = drag
  if (!state) return
  endDrag()
  if (!state.moved) return
  suppressClick = true
  releaseTurn(state.resume ?? 0, 0, false)
}
function onDragKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !drag?.moved) return
  event.preventDefault()
  event.stopPropagation()
  cancelDrag()
}
function pointerDown(event: PointerEvent) {
  if (!props.draggable || props.disabled || drag?.moved || event.button !== 0 || !event.isPrimary || !props.pages.length || manualIntroLocked.value) return
  const bounds = binding.value?.getBoundingClientRect()
  if (!bounds) return
  suppressClick = false
  const spine = bounds.left + bounds.width / 2
  const page = (event.target as Element).closest('.tx-flip-book__page')
  drag = {
    pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false, spine, page: bounds.width / 2,
    side: page ? (page.classList.contains('is-left') ? -1 : 1) : event.clientX < spine ? -1 : 1,
    start: 0, span: bounds.width, tracker: createVelocityTracker(),
  }
}
/** Grabs the page: the one in flight from where it is drawn, otherwise the grabbed side's page from flat. */
function grab(state: NonNullable<typeof drag>) {
  clearIntroTimer()
  introRemaining.value = 0
  introRunning.value = false
  if (flip.value) {
    let progress = turn?.progress ?? drawnProgress(flip.value.direction)
    state.resume = turn ? turn.target : 1
    if (!turn) {
      cancelAnimations()
      progress = Math.max(0, Math.min(1, progress))
      turn = { progress, velocity: 0, lift: false }
    }
    stopTurn()
    turn.target = undefined
    turn.velocity = 0
    // Caught mid-turn there is no telling which point of the page was grabbed: track its edge.
    state.start = (1 - Math.cos(Math.PI * turn.progress)) / 2
    paintTurn()
    return
  }
  const count = props.pages.length
  const to = displayedIndex.value + state.side
  // With no other page to turn to the leaf only lifts, as at either end of a book that does not loop.
  const lift = count < 2 || (!props.loop && (to < 0 || to >= count))
  direction.value = state.side
  flip.value = { from: displayedIndex.value, to: lift ? to : normalize(to), direction: state.side }
  turn = { progress: 0, velocity: 0, lift }
  if (!lift) emit('flip-start', flip.value.from, flip.value.to, state.side)
  // The grabbed point stays under the pointer: a whole turn is twice its distance from the spine.
  state.span = 2 * Math.max(state.page / 3, Math.min(state.page, Math.abs(state.x - state.spine)))
  void nextTick(paintTurn)
}
function pointerMove(event: PointerEvent) {
  const state = drag
  if (!state || state.pointerId !== event.pointerId) return
  const begins = !state.moved
  if (begins) {
    const dx = Math.abs(event.clientX - state.x)
    const dy = Math.abs(event.clientY - state.y)
    if (Math.hypot(dx, dy) < DRAG_SLOP) return
    // A touch that sets off vertically is the page's scroll: the browser pans and cancels it anyway.
    if (event.pointerType !== 'mouse' && dy > dx) { drag = undefined; return }
    state.moved = true
    dragging.value = true
    grab(state)
    binding.value?.setPointerCapture(event.pointerId)
    window.addEventListener('keydown', onDragKeydown, true)
  }
  event.preventDefault()
  if (!turn || !flip.value) return
  const pulled = (event.clientX - state.x) * -flip.value.direction
  // Travel is linear in the pointer; the angle that keeps the grabbed point under it is not.
  const travel = turn.lift
    ? Math.max(0, rubberband(pulled, state.page / 4)) / state.span
    : Math.max(0, Math.min(1, state.start + pulled / state.span))
  turn.progress = Math.acos(1 - 2 * travel) / Math.PI
  paintTurn()
  if (begins) state.tracker.reset(event.timeStamp, travel * state.span)
  else state.tracker.push(event.timeStamp, travel * state.span)
}
function pointerUp(event: PointerEvent) {
  const state = drag
  if (!state || state.pointerId !== event.pointerId) return
  endDrag()
  if (!state.moved || !turn) return
  suppressClick = true
  const [speed] = state.tracker.velocity(event.timeStamp)
  const travel = (1 - Math.cos(Math.PI * turn.progress)) / 2
  // Commit where the flick would carry the page, so a flick turns it from anywhere.
  const commit = !turn.lift && travel + projectMomentum(speed) / state.span > 0.5
  const turnSpeed = speed / state.span * 2 / (Math.PI * Math.max(1e-3, Math.sin(Math.PI * turn.progress)))
  releaseTurn(commit ? 1 : 0, Math.max(-MAX_TURN_SPEED, Math.min(MAX_TURN_SPEED, turnSpeed)), Math.abs(speed) >= FLICK)
}
function scheduleIntro() {
  clearIntroTimer()
  if (!mounted || !active.value || props.disabled || flip.value || introRemaining.value <= 0 || props.pages.length < 2) return
  introTimer = setTimeout(() => {
    introTimer = undefined
    introRunning.value = true
    introRemaining.value--
    const before = current.value
    if (normalize(before + 1) === before) { introRemaining.value = 0; introRunning.value = false; return }
    goTo(before + 1, 1)
  }, introRemaining.value === props.introFlips ? (extracted.value ? 800 : 300) : (extracted.value ? 20 : 70))
}
function replayIntro() {
  if (props.disabled || !props.animated || reduced.value) return
  introRemaining.value = props.introFlips
  scheduleIntro()
}
watch([active, () => props.disabled], () => {
  if (!active.value || props.disabled) {
    clearIntroTimer()
    entrance?.cancel()
    entrance = undefined
    if (flip.value) finishFlip()
  }
  else {
    if (!entrancePlayed && binding.value?.animate) {
      entrancePlayed = true
      entrance = binding.value.animate([
        { transform: extracted.value ? 'translateY(100px) rotateX(20deg) rotateY(-15deg) rotateZ(-5deg) scale(0.8)' : 'rotateX(12deg) rotateY(-10deg) rotateZ(-2deg) scale(0.95)' },
        { transform: extracted.value ? 'translateY(0) rotateX(8deg) rotateY(-6deg) rotateZ(0) scale(1)' : 'rotateX(6deg) rotateY(-4deg) rotateZ(0) scale(1)' },
      ], { duration: extracted.value ? 1500 : 1200, easing: resolveTransition('smooth').easing })
      entrance.onfinish = () => { entrance?.cancel(); entrance = undefined }
    }
    scheduleIntro()
  }
}, { immediate: true })
watch(() => props.intro, value => { introRemaining.value = value ? props.introFlips : 0; scheduleIntro() })
watch(reduced, value => { if (value) introRemaining.value = 0 })
function updateSetting(key: keyof FlipBookSettings, value: string) {
  if (props.disabled) return
  if (key === 'paperColor') settings.paperColor = value
  else settings[key] = Number(value)
  emit('update:settings', { ...settings })
}
function onKeydown(event: KeyboardEvent) {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
  if (event.key === 'ArrowLeft') { event.preventDefault(); previous() }
  else if (event.key === 'ArrowRight') { event.preventDefault(); next() }
  else if (event.key === 'Home') { event.preventDefault(); goTo(0) }
  else if (event.key === 'End') { event.preventDefault(); goTo(props.pages.length - 1) }
}
onDeactivated(() => { if (drag) endDrag(); if (turn) finishFlip() })
onBeforeUnmount(() => { mounted = false; if (drag) endDrag(); stopTurn(); clearIntroTimer(); cancelAnimations(); entrance?.cancel() })
defineExpose({ previous, next, goTo, replayIntro })
</script>

<template>
  <div ref="root" class="tx-flip-book" :class="{ 'is-compact': compact, 'is-flipping': flip, 'is-draggable': draggable && !disabled, 'is-dragging': dragging }" :data-mode="mode" role="group" :aria-label="ariaLabel" @keydown="onKeydown">
    <slot v-if="!pages.length" name="empty" />
    <template v-else>
      <div class="tx-flip-book__perspective" :style="bookStyle">
        <button v-if="extracted && controls" type="button" class="tx-flip-book__side is-previous" :disabled="disabled || !!flip || manualIntroLocked || (!loop && current === 0)" :aria-label="copy.previous" @click="previous">
<svg viewBox="0 0 14 44" width="14" height="44" fill="none" aria-hidden="true"><polyline points="11,3 3,22 11,41" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" /></svg>
</button>
        <button v-if="extracted && controls" type="button" class="tx-flip-book__side is-next" :disabled="disabled || !!flip || manualIntroLocked || (!loop && current === pages.length - 1)" :aria-label="copy.next" @click="next">
<svg viewBox="0 0 14 44" width="14" height="44" fill="none" aria-hidden="true"><polyline points="3,3 11,22 3,41" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" /></svg>
</button>
        <div ref="binding" class="tx-flip-book__binding" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="drag?.pointerId === $event.pointerId && cancelDrag()" @lostpointercapture="$event.target === binding && drag?.pointerId === $event.pointerId && cancelDrag()">
          <div v-for="entry in visiblePages" :key="entry.side" class="tx-flip-book__page" :class="`is-${entry.side}`">
            <div class="tx-flip-book__paper">
<div class="tx-flip-book__content">
              <slot v-if="pageAt(entry.index)" name="page" :page="pageAt(entry.index)!" :index="normalize(entry.index)" :side="entry.side">
                <img v-if="pageAt(entry.index)?.src" :src="pageAt(entry.index)?.src" :alt="pageAt(entry.index)?.alt ?? pageAt(entry.index)?.title ?? ''" draggable="false">
                <div v-else class="tx-flip-book__text">
<strong>{{ pageAt(entry.index)?.title }}</strong><p>{{ pageAt(entry.index)?.content }}</p>
</div>
              </slot>
            </div>
</div>
            <div class="tx-flip-book__crease" aria-hidden="true" />
            <button class="tx-flip-book__turn" type="button" :aria-label="entry.side === 'left' ? copy.previous : copy.next" :disabled="disabled || !!flip || manualIntroLocked || (!loop && (entry.side === 'left' ? current === 0 : current === pages.length - 1))" @click="turnPage(entry.side, $event)">
{{ entry.side === 'left' ? '‹' : '›' }}
</button>
          </div>
          <div v-if="flip" ref="leaf" class="tx-flip-book__leaf" aria-hidden="true">
            <div v-for="entry in leafPages" :key="entry.side" class="tx-flip-book__face" :class="`is-${entry.side}`">
              <div class="tx-flip-book__paper">
<div class="tx-flip-book__content">
                <slot v-if="pageAt(entry.index)" name="page" :page="pageAt(entry.index)!" :index="normalize(entry.index)" :side="entry.side">
                  <img v-if="pageAt(entry.index)?.src" :src="pageAt(entry.index)?.src" :alt="pageAt(entry.index)?.alt ?? pageAt(entry.index)?.title ?? ''" draggable="false">
                  <div v-else class="tx-flip-book__text">
<strong>{{ pageAt(entry.index)?.title }}</strong><p>{{ pageAt(entry.index)?.content }}</p>
</div>
                </slot>
              </div>
</div>
              <div class="tx-flip-book__crease" /><div class="tx-flip-book__shade" />
            </div>
          </div>
        </div>
      </div>
      <div v-if="mode !== 'book' && controls" class="tx-flip-book__controls">
        <button type="button" class="tx-flip-book__bottom-turn" :disabled="disabled || !!flip || manualIntroLocked || (!loop && current === 0)" @click="previous">
{{ copy.previous }}
</button>
        <span aria-live="polite" aria-atomic="true"><TxTextMorph :text="pages[current]?.title || `${current + 1} / ${pages.length}`" :duration-ms="300" :disabled="!active" /></span>
        <button v-if="settingsPanel" type="button" :disabled="disabled" :aria-expanded="settingsOpen" @click="settingsOpen = !settingsOpen">
{{ copy.settings }}
</button>
        <button type="button" class="tx-flip-book__bottom-turn" :disabled="disabled || !!flip || manualIntroLocked || (!loop && current === pages.length - 1)" @click="next">
{{ copy.next }}
</button>
      </div>
      <div v-if="mode !== 'book' && settingsPanel && settingsOpen" class="tx-flip-book__settings">
        <label v-for="field in (['padding', 'imageRadius', 'creaseOpacity', 'shadowIntensity'] as const)" :key="field" class="tx-flip-book__field"><span>{{ copy[field] }} <output>{{ settings[field] }}{{ field === 'creaseOpacity' ? '%' : 'px' }}</output></span><input type="range" min="0" :max="extracted ? (field === 'imageRadius' ? 32 : field === 'shadowIntensity' ? 50 : 100) : (field === 'padding' ? 30 : field === 'shadowIntensity' ? 48 : 40)" :value="settings[field]" :disabled="disabled" @input="updateSetting(field, ($event.target as HTMLInputElement).value)"></label>
        <label class="tx-flip-book__field"><span>{{ copy.paperColor }}</span><input type="text" :value="settings.paperColor" :disabled="disabled" @change="updateSetting('paperColor', ($event.target as HTMLInputElement).value)"></label>
        <button type="button" :disabled="disabled || !animated || reduced || !!flip" @click="replayIntro">
{{ copy.intro }}
</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tx-flip-book { position: relative; width: 100%; font-size: 13px; color: var(--tx-text-color-primary); }
.tx-flip-book__perspective { position: relative; width: calc(100% - 24px); margin: 12px auto; aspect-ratio: 16 / 10; perspective: 2400px; }
.tx-flip-book__binding { position: absolute; inset: 0; transform: var(--tx-book-pose); transform-style: preserve-3d; border-radius: 6px; box-shadow: 6px 12px 24px color-mix(in srgb, var(--tx-text-color-primary) 18%, transparent); }
/* A horizontal drag turns the page and a vertical swipe still scrolls the page. */
.tx-flip-book.is-draggable .tx-flip-book__binding { cursor: grab; touch-action: pan-y; -webkit-user-select: none; user-select: none; }
.tx-flip-book.is-dragging .tx-flip-book__binding { cursor: grabbing; }
.tx-flip-book__page { position: absolute; inset-block: 0; width: 50%; overflow: hidden; background: var(--tx-book-paper); box-shadow: inset 0 0 0 1px var(--tx-border-color); }
.tx-flip-book__page.is-left { left: 0; border-radius: 6px 0 0 6px; }
.tx-flip-book__page.is-right { right: 0; border-radius: 0 6px 6px 0; }
.tx-flip-book__paper { position: absolute; inset: 0; background-color: var(--tx-book-paper); background-image: repeating-radial-gradient(circle at 17% 31%, color-mix(in srgb, var(--tx-text-color-primary) 3%, transparent) 0 0.5px, transparent 0.5px 3px); padding: var(--tx-book-padding); box-sizing: border-box; }
.tx-flip-book__content { width: 100%; height: 100%; border-radius: var(--tx-book-radius); box-shadow: 2px 4px var(--tx-book-shadow) color-mix(in srgb, var(--tx-text-color-primary) 15%, transparent); overflow: hidden; }
.tx-flip-book__content img { width: 100%; height: 100%; display: block; object-fit: cover; }
.tx-flip-book__text { display: flex; height: 100%; box-sizing: border-box; flex-direction: column; justify-content: center; gap: 8px; padding: 12px; overflow: auto; }
.tx-flip-book__text strong { font-size: 14px; font-weight: var(--tx-font-weight-semibold, 600); }
.tx-flip-book__text p { font-size: 13px; margin: 0; line-height: 1.5; }
.tx-flip-book__crease { position: absolute; inset-block: 0; width: var(--tx-book-crease-width); pointer-events: none; background: linear-gradient(to right, color-mix(in srgb, var(--tx-text-color-primary) var(--tx-book-crease), transparent), color-mix(in srgb, var(--tx-text-color-primary) var(--tx-book-crease-soft), transparent), transparent); box-shadow: inset 4px 0 10px color-mix(in srgb, var(--tx-text-color-primary) 10%, transparent); left: 0; }
.is-left > .tx-flip-book__crease, .is-back > .tx-flip-book__crease { left: auto; right: 0; transform: scaleX(-1); }
.tx-flip-book__turn { position: absolute; inset: 0; width: 100%; padding: 0 12px; border: 0; background: transparent; color: var(--tx-text-color-regular); cursor: pointer; font-size: 24px; opacity: 0; text-align: right; }
.tx-flip-book.is-draggable .tx-flip-book__turn:not(:disabled) { cursor: grab; }
/* Disabled mid-turn, or at an end that does not loop, a turn button lets the page beneath it be grabbed. */
.tx-flip-book.is-draggable .tx-flip-book__turn:disabled { pointer-events: none; }
.is-left > .tx-flip-book__turn { text-align: left; }
.tx-flip-book__page:hover .tx-flip-book__turn, .tx-flip-book__turn:focus-visible { opacity: 1; }
.tx-flip-book__leaf { position: absolute; left: 50%; top: 0; width: 50%; height: 100%; transform-origin: left; transform-style: preserve-3d; z-index: 3; }
.tx-flip-book__face { position: absolute; inset: 0; backface-visibility: hidden; overflow: hidden; background: var(--tx-book-paper); border-radius: 0 6px 6px 0; }
.tx-flip-book__face.is-back { transform: rotateY(180deg); border-radius: 6px 0 0 6px; }
.tx-flip-book__shade { position: absolute; inset: 0; background: linear-gradient(to right, transparent, var(--tx-text-color-primary)); pointer-events: none; opacity: 0; }
.is-back > .tx-flip-book__shade { transform: scaleX(-1); }
.tx-flip-book__controls { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px; padding: 6px 12px; }
.tx-flip-book button:not(.tx-flip-book__turn) { border: 0; padding: 6px 10px; border-radius: 8px; background: var(--tx-fill-color-light); color: var(--tx-text-color-regular); font: inherit; cursor: pointer; }
.tx-flip-book button:hover:not(:disabled) { background-color: var(--tx-fill-color); }
.tx-flip-book button:focus-visible, .tx-flip-book input:focus-visible { outline: 2px solid var(--tx-color-primary); outline-offset: 2px; }
.tx-flip-book button:disabled { cursor: not-allowed; opacity: 0.5; }
.tx-flip-book__settings { display: grid; gap: 12px; padding: 12px; max-width: 400px; margin: 8px auto; background: var(--tx-bg-color); border-radius: 12px; box-shadow: inset 0 0 0 1px var(--tx-border-color); }
.tx-flip-book__field { display: grid; gap: 4px; font-size: 13px; }
.tx-flip-book__field > span { display: flex; justify-content: space-between; gap: 8px; }
.tx-flip-book__field input { min-width: 0; width: 100%; box-sizing: border-box; accent-color: var(--tx-color-primary); font: inherit; }
.tx-flip-book .tx-flip-book__side { position: absolute; top: 50%; transform: translateY(-50%); z-index: 4; background: transparent; padding: 6px; }
.tx-flip-book__side.is-previous { left: -24px; }
.tx-flip-book__side.is-next { right: -24px; }
.tx-flip-book[data-mode='extracted-book'] .tx-flip-book__perspective { width: calc(100% - 72px); }
.tx-flip-book[data-mode='extracted-book'] .tx-flip-book__settings { position: absolute; top: 12px; right: 12px; width: min(320px, calc(100% - 48px)); z-index: 5; }
@media (min-width: 640px) { .tx-flip-book[data-mode='extracted-book'] .tx-flip-book__bottom-turn { display: none; } }
@media (max-width: 639px) { .tx-flip-book__side { display: none; } .tx-flip-book[data-mode='extracted-book'] .tx-flip-book__perspective { width: calc(100% - 24px); } }
@media (prefers-reduced-motion: reduce) { .tx-flip-book__binding { transform: none; } }
</style>
