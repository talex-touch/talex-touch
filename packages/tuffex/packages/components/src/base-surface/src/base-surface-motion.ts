import type { ComputedRef, Ref } from 'vue'
import type { BaseSurfaceMode, BaseSurfaceProps } from './types'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { hasWindow } from '../../../../utils/env'
import { clamp, smoothstep01 } from './base-surface-math'
import { SURFACE_MOTION_SETTLE_MS, useSurfaceMotionGuard } from './surface-environment'

export const SURFACE_MOTION_DURATION_MS = 299
export const REFRACTION_PARAM_BLEND_DURATION_MS = 182
export const REFRACTION_MASK_RELEASE_DELAY_AFTER_FALLBACK_MS = 60
export const REFRACTION_RECOVERY_DURATION_FACTOR = 0.35
export const REFRACTION_MASK_RELEASE_DURATION_MS = Math.round(650 * REFRACTION_RECOVERY_DURATION_FACTOR)
export const REFRACTION_MASK_PEAK_OPACITY = 0.95
/**
 * Opacity of the dedicated motion cover while a refraction surface moves.
 * Deliberately translucent: the sampling-stale filter layers fade themselves
 * out (layered degradation), so the cover only has to hold the surface's
 * visual weight — it no longer has to HIDE anything, which is what used to
 * force it up to the near-opaque mask peak and made the recovery read as a
 * solid colour slowly draining away.
 */
export const REFRACTION_MOTION_COVER_OPACITY = 0.55
export const REFRACTION_MASK_PEAK_RAMP_DURATION_MS = 180
export const REFRACTION_EDGE_REVEAL_DELAY_MS = 60
export const REFRACTION_EDGE_REVEAL_DURATION_MS = 220
export const REFRACTION_MASK_RELEASE_SLOWDOWN = 1
export const REFRACTION_MOVING_PARAM_FLOOR = 0.28

interface UseBaseSurfaceMotionOptions {
  props: Readonly<BaseSurfaceProps>
  /** The mode the surface renders, after `autoDetect`'s environment degradation; `props.mode` when absent. */
  mode?: ComputedRef<BaseSurfaceMode>
  /** Page-wide motion `autoDetect` infers (a fast drag, a moving window), already held for its settle time. */
  environmentMoving?: ComputedRef<boolean>
  /** How long the surface's own transform signals stay quiet before the motion ends; 140ms by default. */
  autoDetectSettleMs?: number
  rootRef: Ref<HTMLElement | null>
  needsFallback: ComputedRef<boolean>
  settleDelayMs: ComputedRef<number>
  refractionRecoveryBlendDurationMs: ComputedRef<number>
  refractionRecoveryTotalDurationMs: ComputedRef<number>
}

export function useBaseSurfaceMotion(options: UseBaseSurfaceMotionOptions) {
  const { props, rootRef, needsFallback, settleDelayMs, refractionRecoveryBlendDurationMs, refractionRecoveryTotalDurationMs } = options
  const mode = options.mode ?? computed<BaseSurfaceMode>(() => props.mode ?? 'refraction')

  // Transform transitions and inline transforms on the surface or an ancestor. They pass
  // through the same asymmetric clock as the page-wide signals: on at once, off 140ms later.
  const localMoving = ref(false)
  const localGuard = useSurfaceMotionGuard((value) => {
    localMoving.value = value
  }, { settleMs: options.autoDetectSettleMs ?? SURFACE_MOTION_SETTLE_MS })
  const autoMoving = computed(() =>
    !!props.autoDetect && (localMoving.value || !!options.environmentMoving?.value),
  )
  const settling = ref(false)
  const refractionRecovering = ref(false)
  const refractionRecoveryProgress = ref(1)
  const refractionRecoveryElapsed = ref(0)
  const refractionMaskPeakRampProgress = ref(1)
  const refractionEdgeRevealProgress = ref(1)

  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let mutationObserver: MutationObserver | null = null
  let observedElements: HTMLElement[] = []
  // The two local sources, each ended only by its own kind of event: the transform
  // transitions running on observed elements, and whether an inline transform is present.
  const runningTransitions = new Map<EventTarget, Set<string>>()
  let inlineTransforming = false
  let refractionRecoveryRaf: number | null = null
  let refractionMaskPeakRampRaf: number | null = null
  let refractionEdgeRevealRaf: number | null = null
  let refractionEdgeRevealTimer: ReturnType<typeof setTimeout> | null = null

  const isMoving = computed(() => props.moving || autoMoving.value)

  function stopRefractionEdgeReveal(resetProgress = true) {
    if (refractionEdgeRevealTimer != null) {
      clearTimeout(refractionEdgeRevealTimer)
      refractionEdgeRevealTimer = null
    }
    if (refractionEdgeRevealRaf != null) {
      cancelAnimationFrame(refractionEdgeRevealRaf)
      refractionEdgeRevealRaf = null
    }
    if (resetProgress) {
      refractionEdgeRevealProgress.value = 1
    }
  }

  function hideRefractionEdge() {
    stopRefractionEdgeReveal(false)
    refractionEdgeRevealProgress.value = 0
  }

  function startRefractionEdgeReveal() {
    if (mode.value !== 'refraction') {
      refractionEdgeRevealProgress.value = 1
      return
    }
    if (!hasWindow()) {
      refractionEdgeRevealProgress.value = 1
      return
    }

    stopRefractionEdgeReveal(false)
    refractionEdgeRevealProgress.value = 0
    refractionEdgeRevealTimer = setTimeout(() => {
      refractionEdgeRevealTimer = null
      const total = Math.max(80, REFRACTION_EDGE_REVEAL_DURATION_MS)
      let startedAt = 0
      const tick = (timestamp: number) => {
        if (!startedAt) {
          startedAt = timestamp
        }
        const elapsed = timestamp - startedAt
        const progress = clamp(elapsed / total, 0, 1)
        refractionEdgeRevealProgress.value = smoothstep01(progress)
        if (progress >= 1 || isMoving.value || refractionRecovering.value) {
          if (isMoving.value || refractionRecovering.value) {
            refractionEdgeRevealProgress.value = 0
          }
          else {
            refractionEdgeRevealProgress.value = 1
          }
          refractionEdgeRevealRaf = null
          return
        }
        refractionEdgeRevealRaf = requestAnimationFrame(tick)
      }
      refractionEdgeRevealRaf = requestAnimationFrame(tick)
    }, Math.max(0, REFRACTION_EDGE_REVEAL_DELAY_MS))
  }

  function stopRefractionMaskPeakRamp(resetProgress = true) {
    if (refractionMaskPeakRampRaf != null) {
      cancelAnimationFrame(refractionMaskPeakRampRaf)
      refractionMaskPeakRampRaf = null
    }
    if (resetProgress) {
      refractionMaskPeakRampProgress.value = 1
    }
  }

  function startRefractionMaskPeakRamp() {
    if (mode.value !== 'refraction') {
      refractionMaskPeakRampProgress.value = 1
      return
    }
    if (!hasWindow()) {
      refractionMaskPeakRampProgress.value = 1
      return
    }

    stopRefractionMaskPeakRamp(false)
    refractionMaskPeakRampProgress.value = 0

    const total = Math.max(40, REFRACTION_MASK_PEAK_RAMP_DURATION_MS)
    let startedAt = 0

    const tick = (timestamp: number) => {
      if (!startedAt) {
        startedAt = timestamp
      }
      const elapsed = timestamp - startedAt
      const progress = clamp(elapsed / total, 0, 1)
      refractionMaskPeakRampProgress.value = smoothstep01(progress)
      if (progress >= 1 || !isMoving.value) {
        refractionMaskPeakRampProgress.value = 1
        refractionMaskPeakRampRaf = null
        return
      }
      refractionMaskPeakRampRaf = requestAnimationFrame(tick)
    }

    refractionMaskPeakRampRaf = requestAnimationFrame(tick)
  }

  function stopRefractionRecovery(resetProgress = true) {
    if (refractionRecoveryRaf != null) {
      cancelAnimationFrame(refractionRecoveryRaf)
      refractionRecoveryRaf = null
    }
    refractionRecovering.value = false
    refractionRecoveryElapsed.value = 0
    if (resetProgress) {
      refractionRecoveryProgress.value = 1
    }
  }

  function startRefractionRecovery() {
    if (mode.value !== 'refraction') {
      return
    }
    if (isMoving.value) {
      return
    }
    if (refractionRecovering.value) {
      return
    }
    if (!hasWindow()) {
      refractionRecovering.value = false
      refractionRecoveryProgress.value = 1
      refractionRecoveryElapsed.value = 0
      return
    }

    stopRefractionRecovery(false)
    refractionRecovering.value = true
    refractionRecoveryProgress.value = 0
    refractionRecoveryElapsed.value = 0

    const blendTotal = refractionRecoveryBlendDurationMs.value
    const total = refractionRecoveryTotalDurationMs.value
    let startedAt = 0

    const tick = (timestamp: number) => {
      if (!startedAt) {
        startedAt = timestamp
      }

      const elapsed = timestamp - startedAt
      refractionRecoveryElapsed.value = elapsed

      const progress = blendTotal <= 0
        ? 1
        : smoothstep01(elapsed / blendTotal)

      refractionRecoveryProgress.value = clamp(progress, 0, 1)

      if (elapsed >= total) {
        refractionRecovering.value = false
        refractionRecoveryProgress.value = 1
        refractionRecoveryElapsed.value = total
        refractionRecoveryRaf = null
        return
      }
      refractionRecoveryRaf = requestAnimationFrame(tick)
    }

    refractionRecoveryRaf = requestAnimationFrame(tick)
  }

  function startSettleTimer() {
    clearTimeout(settleTimer)
    settling.value = true
    settleTimer = setTimeout(() => {
      settling.value = false
    }, settleDelayMs.value)
  }

  function onAutoMotionStart() {
    clearTimeout(settleTimer)
    settling.value = false
    if (mode.value === 'refraction') {
      stopRefractionRecovery(false)
      refractionRecoveryProgress.value = 0
      refractionRecoveryElapsed.value = 0
    }
  }

  function onAutoMotionEnd() {
    if (mode.value === 'refraction') {
      startRefractionRecovery()
      return
    }
    startSettleTimer()
  }

  /**
   * Whether a transition event reports one of the observed elements moving. Transition
   * events bubble, so the listener on `<html>` also hears a switch thumb sliding elsewhere
   * on the page; only the element the listener sits on moves the surface.
   */
  function isOwnTransformTransition(e: TransitionEvent) {
    return e.target === e.currentTarget && (e.propertyName === 'transform' || e.propertyName === 'translate')
  }

  function syncLocalMotion() {
    if (runningTransitions.size > 0 || inlineTransforming)
      localGuard.onMotionStart()
    else
      localGuard.onMotionEnd()
  }

  function handleTransitionStart(e: TransitionEvent) {
    if (!isOwnTransformTransition(e) || !e.target)
      return
    const properties = runningTransitions.get(e.target) ?? new Set<string>()
    properties.add(e.propertyName)
    runningTransitions.set(e.target, properties)
    syncLocalMotion()
  }

  function handleTransitionEnd(e: TransitionEvent) {
    if (!isOwnTransformTransition(e) || !e.target)
      return
    const properties = runningTransitions.get(e.target)
    properties?.delete(e.propertyName)
    if (!properties?.size)
      runningTransitions.delete(e.target)
    syncLocalMotion()
  }

  /**
   * Whether `el` currently carries an *inline* transform.
   *
   * Inline-only on purpose. Computed style would report transforms that have
   * nothing to do with motion — a permanently `translateZ`-ed ancestor, say —
   * and would pin the surface as moving forever. The tradeoff is that the
   * MutationObserver path only tracks inline-transform motion (FLIP-style
   * animations, which is what `autoDetect` exists for); class- and
   * stylesheet-driven transitions are handled by the `transitionstart` /
   * `transitionend` listeners instead.
   *
   * Note this checks *presence*, not change — the name predates that behaviour.
   */
  function hasInlineTransform(el: HTMLElement) {
    const transform = el.style.transform || el.style.getPropertyValue('transform')
    return transform && transform !== 'none' && transform !== ''
  }

  function setupAutoDetect() {
    if (!props.autoDetect || !hasWindow() || !rootRef.value) {
      return
    }

    const el = rootRef.value
    const targets: HTMLElement[] = []
    let current: HTMLElement | null = el
    while (current) {
      targets.push(current)
      current = current.parentElement
    }
    observedElements = targets

    for (const target of targets) {
      target.addEventListener('transitionstart', handleTransitionStart as EventListener)
      target.addEventListener('transitionend', handleTransitionEnd as EventListener)
      target.addEventListener('transitioncancel', handleTransitionEnd as EventListener)
    }

    mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
          const target = mutation.target as HTMLElement
          if (hasInlineTransform(target)) {
            inlineTransforming = true
            syncLocalMotion()
          }
          // A style write on a non-transforming element only ends the inline motion once
          // nothing under observation is transforming any more. Checking just the mutated
          // element would let an unrelated write end it: flip-overlay's body scroll lock
          // sets `body.style.overflow`, and body is an observed ancestor. Nor does a style
          // write end a transition: the surface rewrites its own variables every frame it moves.
          else if (inlineTransforming && !targets.some(hasInlineTransform)) {
            inlineTransforming = false
            syncLocalMotion()
          }
        }
      }
    })

    for (const target of targets) {
      mutationObserver.observe(target, { attributes: true, attributeFilter: ['style'] })
    }
  }

  function teardownAutoDetect() {
    for (const target of observedElements) {
      target.removeEventListener('transitionstart', handleTransitionStart as EventListener)
      target.removeEventListener('transitionend', handleTransitionEnd as EventListener)
      target.removeEventListener('transitioncancel', handleTransitionEnd as EventListener)
    }
    observedElements = []
    mutationObserver?.disconnect()
    mutationObserver = null
    runningTransitions.clear()
    inlineTransforming = false
    localGuard.dispose()
    localMoving.value = false
    clearTimeout(settleTimer)
    stopRefractionEdgeReveal()
    stopRefractionMaskPeakRamp()
    stopRefractionRecovery()
  }

  watch(autoMoving, (moving, wasMoving) => {
    if (moving && !wasMoving)
      onAutoMotionStart()
    else if (!moving && wasMoving)
      onAutoMotionEnd()
  })

  watch(() => props.moving, (newVal, oldVal) => {
    if (mode.value === 'refraction') {
      if (newVal) {
        stopRefractionRecovery(false)
        refractionRecoveryProgress.value = 0
        refractionRecoveryElapsed.value = 0
        return
      }
      if (oldVal && !newVal) {
        startRefractionRecovery()
      }
      return
    }
    if (oldVal && !newVal && needsFallback.value) {
      startSettleTimer()
    }
  })

  watch(isMoving, (moving, prevMoving) => {
    if (mode.value !== 'refraction') {
      stopRefractionMaskPeakRamp()
      stopRefractionEdgeReveal()
      return
    }
    if (moving && !prevMoving) {
      hideRefractionEdge()
      startRefractionMaskPeakRamp()
      return
    }
    if (!moving) {
      stopRefractionMaskPeakRamp()
    }
  }, { flush: 'sync' })

  watch(
    [isMoving, refractionRecovering, mode],
    ([moving, recovering, current], [prevMoving, prevRecovering, prevMode]) => {
      if (current !== 'refraction') {
        stopRefractionEdgeReveal()
        return
      }
      if (moving || recovering) {
        hideRefractionEdge()
        return
      }
      if (prevMode !== 'refraction' || prevMoving || prevRecovering) {
        startRefractionEdgeReveal()
      }
    },
    { flush: 'sync' },
  )

  watch(mode, (current) => {
    if (current !== 'refraction') {
      stopRefractionMaskPeakRamp()
      stopRefractionEdgeReveal()
      stopRefractionRecovery()
      return
    }
    if (isMoving.value) {
      hideRefractionEdge()
      startRefractionMaskPeakRamp()
      stopRefractionRecovery(false)
      refractionRecoveryProgress.value = 0
      refractionRecoveryElapsed.value = 0
      return
    }
    startRefractionEdgeReveal()
    stopRefractionMaskPeakRamp()
    stopRefractionRecovery()
  })

  watch(() => props.autoDetect, (newVal) => {
    teardownAutoDetect()
    if (newVal) {
      setupAutoDetect()
    }
  })

  onMounted(() => {
    setupAutoDetect()
  })

  onBeforeUnmount(() => {
    teardownAutoDetect()
    // Every scheduled callback dies with the component: the settle timer and
    // the three recovery loops all close over its refs, and firing after
    // unmount means writing to a dead component (and, under test, calling
    // requestAnimationFrame in an environment that no longer has one).
    if (settleTimer !== undefined) {
      clearTimeout(settleTimer)
      settleTimer = undefined
    }
    stopRefractionEdgeReveal(false)
    stopRefractionMaskPeakRamp(false)
    stopRefractionRecovery(false)
  })

  return {
    isMoving,
    settling,
    refractionRecovering,
    refractionRecoveryProgress,
    refractionRecoveryElapsed,
    refractionMaskPeakRampProgress,
    refractionEdgeRevealProgress,
  }
}
