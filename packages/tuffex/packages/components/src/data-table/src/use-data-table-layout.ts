import type { Ref } from 'vue'
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'

export interface DataTableShimmerLayer {
  /** The table's box inside the root, which the bands are positioned against. */
  top: number
  left: number
  width: number
  height: number
  bands: Array<{ index: number, top: number, height: number }>
}

interface DataTableLayoutOptions {
  root: Readonly<Ref<HTMLElement | null>>
  table: Readonly<Ref<HTMLTableElement | null>>
  /** Header cell positions whose widths feed the sticky offsets. */
  stickyCells: () => number[]
  /** The root scrolls itself (`scrollX` or the sticky shell). */
  scroller: () => boolean
  /** Which measurements are live; each costs a layout read per frame it runs. */
  overlay: () => boolean
  placeholders: () => boolean
  shimmer: () => boolean
}

// A long table only needs bands where they can be seen: the rows inside the
// root's scrollport plus this margin, and never more than the cap.
const SHIMMER_MARGIN = 240
const SHIMMER_BAND_LIMIT = 200

function sameLayer(a: DataTableShimmerLayer | null, b: DataTableShimmerLayer | null): boolean {
  if (!a || !b)
    return a === b
  if (a.top !== b.top || a.left !== b.left || a.width !== b.width || a.height !== b.height || a.bands.length !== b.bands.length)
    return false
  return a.bands.every((band, i) => band.index === b.bands[i]!.index && band.top === b.bands[i]!.top && band.height === b.bands[i]!.height)
}

// Measures what CSS cannot know on its own: the widths a sticky column offsets
// by, whether the root is scrolled away from either edge, the visible height a
// loading veil has to cover, how many placeholder rows fill a host-sized table,
// and where each row sits for the shimmer bands. Everything reads in one frame
// and writes back only on change. Until the first frame — and wherever layout
// never happens (SSR, jsdom) — every value stays at its rest state, so the
// component falls back to its declared widths and plain CSS.
export function useDataTableLayout(options: DataTableLayoutOptions) {
  const cellWidths = ref<Record<number, number>>({})
  const overflowLeft = ref(false)
  const overflowRight = ref(false)
  const viewportHeight = ref(0)
  const fillRows = ref(0)
  const shimmerLayer = shallowRef<DataTableShimmerLayer | null>(null)

  let frame = 0
  let observer: ResizeObserver | null = null
  let rtl = false

  function measureStickyWidths(table: HTMLTableElement) {
    const cells = table.tHead?.rows[0]?.cells
    const next: Record<number, number> = {}
    let changed = false
    for (const index of options.stickyCells()) {
      const width = cells?.[index]?.getBoundingClientRect().width ?? 0
      if (width > 0)
        next[index] = width
      if (Math.abs((cellWidths.value[index] ?? 0) - (next[index] ?? 0)) > 0.25)
        changed = true
    }
    if (changed || Object.keys(next).length !== Object.keys(cellWidths.value).length)
      cellWidths.value = next
  }

  function measureOverflow(root: HTMLElement) {
    // Only a sticky column's edge line reads these.
    if (!options.scroller() || !options.stickyCells().length) {
      overflowLeft.value = false
      overflowRight.value = false
      return
    }
    // Distance travelled from the inline start. Right-to-left scrollers report a
    // negative scrollLeft, so the start is the right edge there.
    const max = root.scrollWidth - root.clientWidth
    const travelled = Math.abs(root.scrollLeft)
    const atStart = travelled <= 0.5
    const atEnd = travelled >= max - 0.5
    overflowLeft.value = rtl ? !atEnd : !atStart
    overflowRight.value = rtl ? !atStart : !atEnd
  }

  function mainBody(table: HTMLTableElement): HTMLTableSectionElement | undefined {
    return table.tBodies[table.tBodies.length - 1]
  }

  function measureFill(root: HTMLElement, table: HTMLTableElement) {
    const row = mainBody(table)?.rows[0]
    const rowHeight = row?.getBoundingClientRect().height ?? 0
    if (!rowHeight) {
      fillRows.value = 0
      return
    }
    const chrome = (table.tHead?.getBoundingClientRect().height ?? 0) + (table.tFoot?.getBoundingClientRect().height ?? 0)
    // Counted against the root's own height, which only exceeds the rows when a
    // host gives the table a height: an unconstrained root is exactly as tall as
    // its rows, so the count reproduces itself and the loop settles at once.
    fillRows.value = Math.max(0, Math.floor((root.clientHeight - chrome) / rowHeight + 0.01))
  }

  function measureShimmer(root: HTMLElement, table: HTMLTableElement) {
    const tableRect = table.getBoundingClientRect()
    const rows = mainBody(table)?.rows ?? []
    let low = Number.NEGATIVE_INFINITY
    let high = Number.POSITIVE_INFINITY
    if (options.scroller()) {
      const rootRect = root.getBoundingClientRect()
      low = rootRect.top - SHIMMER_MARGIN
      high = rootRect.bottom + SHIMMER_MARGIN
    }
    const bands: DataTableShimmerLayer['bands'] = []
    for (let index = 0; index < rows.length && bands.length < SHIMMER_BAND_LIMIT; index++) {
      const row = rows[index]!
      if (!row.classList.contains('tx-data-table__row') || row.classList.contains('tx-data-table__row--detail'))
        continue
      const rect = row.getBoundingClientRect()
      if (!rect.height || rect.bottom < low)
        continue
      if (rect.top > high)
        break
      bands.push({ index, top: rect.top - tableRect.top, height: rect.height })
    }
    const next = bands.length
      ? { top: table.offsetTop, left: table.offsetLeft, width: tableRect.width, height: tableRect.height, bands }
      : null
    // Scrolling re-measures every frame; the bands only re-render when they moved.
    if (!sameLayer(shimmerLayer.value, next))
      shimmerLayer.value = next
  }

  function measure() {
    frame = 0
    const root = options.root.value
    const table = options.table.value
    if (!root || !table)
      return
    measureStickyWidths(table)
    measureOverflow(root)
    viewportHeight.value = options.overlay() ? root.clientHeight : 0
    if (options.placeholders())
      measureFill(root, table)
    else
      fillRows.value = 0
    if (options.shimmer())
      measureShimmer(root, table)
    else
      shimmerLayer.value = null
  }

  function schedule() {
    if (frame || typeof requestAnimationFrame !== 'function')
      return
    frame = requestAnimationFrame(measure)
  }

  function observe() {
    observer?.disconnect()
    const root = options.root.value
    const table = options.table.value
    if (!observer || !root || !table)
      return
    observer.observe(root)
    observer.observe(table)
    // A column can change width while the table keeps its size, so the cells
    // that set an offset are watched themselves.
    const cells = table.tHead?.rows[0]?.cells
    for (const index of options.stickyCells()) {
      const cell = cells?.[index]
      if (cell)
        observer.observe(cell)
    }
  }

  // Scrolling moves the edge lines and, while rows shimmer, the band window.
  function onScroll() {
    const root = options.root.value
    if (!root)
      return
    measureOverflow(root)
    if (options.shimmer())
      schedule()
  }

  onMounted(() => {
    const root = options.root.value
    if (!root)
      return
    rtl = getComputedStyle(root).direction === 'rtl'
    if (typeof ResizeObserver !== 'undefined')
      observer = new ResizeObserver(schedule)
    observe()
    root.addEventListener('scroll', onScroll, { passive: true })
    schedule()
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
    options.root.value?.removeEventListener('scroll', onScroll)
    if (frame && typeof cancelAnimationFrame === 'function')
      cancelAnimationFrame(frame)
    frame = 0
  })

  // Anything that can move a row or a column re-measures after the DOM updates.
  function track(source: () => unknown) {
    watch(source, () => {
      observe()
      schedule()
    }, { flush: 'post' })
  }

  return { cellWidths, overflowLeft, overflowRight, viewportHeight, fillRows, shimmerLayer, track, schedule }
}
