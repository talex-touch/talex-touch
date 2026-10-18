import type { Ref } from 'vue'
import { onBeforeUnmount, onDeactivated, ref } from 'vue'

/** Movement before a press becomes a drag; a shorter press is still a click. */
export const SCRUB_SLOP = 4

export interface PressScrubOptions {
  /** A touch or pen press, which has no hover to have placed a reading. */
  press?: (event: PointerEvent) => void
  /** Every move of a drag, from the one that crosses the slop. */
  read: (event: PointerEvent) => void
  /** Escape, `pointercancel` or a lost capture interrupted the press or drag. */
  cancel?: () => void
  /** A drag finished, released or interrupted; runs after `cancel`. */
  end?: () => void
}

export interface PressScrub {
  pointerdown: (event: PointerEvent) => void
  /** Whether the move belonged to a drag and was read. */
  pointermove: (event: PointerEvent) => boolean
  pointerup: (event: PointerEvent) => void
  pointercancel: (event: PointerEvent) => void
  lostpointercapture: (event: PointerEvent) => void
  /** The press moved past the slop and holds the pointer. */
  dragging: Readonly<Ref<boolean>>
}

/**
 * Press-drag reading on a surface that hover already reads.
 *
 * Capture is taken only past the slop, so a click still lands on what it pressed. Once captured,
 * events stop reaching the element under the pointer, so `read` works from coordinates. A touch
 * drag starts only sideways: the surface is `touch-action: pan-y` and a vertical swipe belongs to
 * the page. The click a drag ends with is swallowed wherever it lands; Escape cancels.
 */
export function usePressScrub(surface: Readonly<Ref<Element | null>>, options: PressScrubOptions): PressScrub {
  const dragging = ref(false)
  let press: { id: number, x: number, y: number, direct: boolean } | null = null
  let swallowing = false

  function swallow(event: MouseEvent): void {
    // Keyboard and programmatic clicks (detail 0) never end a drag.
    if (event.detail === 0)
      return
    event.preventDefault()
    event.stopImmediatePropagation()
    disarm()
  }

  function disarm(): void {
    if (!swallowing)
      return
    swallowing = false
    window.removeEventListener('click', swallow, true)
    window.removeEventListener('pointerdown', disarm, true)
  }

  function arm(): void {
    if (swallowing)
      return
    swallowing = true
    window.addEventListener('click', swallow, true)
    // A drag that ends without a click (a touch past the tap slop) must not eat the next one.
    window.addEventListener('pointerdown', disarm, true)
  }

  function escape(event: KeyboardEvent): void {
    if (event.key !== 'Escape')
      return
    event.preventDefault()
    event.stopPropagation()
    finish(true)
  }

  function finish(cancelled: boolean): void {
    const current = press
    const dragged = dragging.value
    press = null
    if (dragged) {
      dragging.value = false
      window.removeEventListener('keydown', escape, true)
      try {
        if (current && surface.value?.hasPointerCapture?.(current.id))
          surface.value.releasePointerCapture(current.id)
      }
      catch {}
    }
    if (cancelled && current)
      options.cancel?.()
    if (dragged)
      options.end?.()
  }

  function pointerdown(event: PointerEvent): void {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0))
      return
    finish(false)
    const direct = event.pointerType !== 'mouse'
    press = { id: event.pointerId, x: event.clientX, y: event.clientY, direct }
    if (direct)
      options.press?.(event)
  }

  function pointermove(event: PointerEvent): boolean {
    const current = press
    if (!current || event.pointerId !== current.id)
      return false
    if (!dragging.value) {
      // Released off the surface, a press never heard its pointerup; without a button it is hover.
      if (!current.direct && (event.buttons & 1) === 0) {
        press = null
        return false
      }
      const dx = event.clientX - current.x
      const dy = event.clientY - current.y
      if (Math.hypot(dx, dy) < SCRUB_SLOP || (current.direct && Math.abs(dy) > Math.abs(dx)))
        return false
      dragging.value = true
      try {
        surface.value?.setPointerCapture?.(event.pointerId)
      }
      catch {}
      window.addEventListener('keydown', escape, true)
      arm()
    }
    options.read(event)
    return true
  }

  function pointerup(event: PointerEvent): void {
    if (press?.id === event.pointerId)
      finish(false)
  }

  function pointercancel(event: PointerEvent): void {
    if (press?.id === event.pointerId)
      finish(true)
  }

  function lostpointercapture(event: PointerEvent): void {
    // A mark that held a touch's implicit capture loses it to the surface; that bubbles here too.
    if (event.target === event.currentTarget && dragging.value && press?.id === event.pointerId)
      finish(true)
  }

  function dispose(): void {
    finish(false)
    disarm()
  }
  onDeactivated(dispose)
  onBeforeUnmount(dispose)

  return { pointerdown, pointermove, pointerup, pointercancel, lostpointercapture, dragging }
}
