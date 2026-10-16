import type { MaybeRefOrGetter, Ref, WatchSource } from 'vue'
import { onBeforeUnmount, ref, toValue, watch } from 'vue'
import { hasWindow } from './env'

/**
 * `true` for `durationMs` after any of `sources` changes.
 *
 * A component puts its colour transitions on `.is-morphing` alone, so a state
 * change (checked, active, open, focused) eases its fill and ink while a hover,
 * which never flips the class, repaints at once ("Hover colour changes are
 * immediate" in tuffex-design-rules.md). Give it the longest colour leg, or
 * the class comes off mid-tween and cuts the transition short.
 *
 * The watcher runs before the render the change causes, so the class and the
 * new state land in the same frame. Under `prefers-reduced-motion: reduce` it
 * stays `false`.
 */
export function useMorphWindow(
  sources: WatchSource | WatchSource[],
  durationMs: MaybeRefOrGetter<number>,
): Ref<boolean> {
  const morphing = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  function clear(): void {
    if (timer !== undefined)
      clearTimeout(timer)
    timer = undefined
  }

  watch(sources, () => {
    clear()
    if (hasWindow() && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      morphing.value = false
      return
    }
    morphing.value = true
    timer = setTimeout(() => {
      timer = undefined
      morphing.value = false
    }, toValue(durationMs))
  })

  onBeforeUnmount(clear)
  return morphing
}
