<script setup lang="ts">
import type { DataTableColumn, DataTableEmits, DataTableHeaderSlotProps, DataTableKey, DataTableLabels, DataTableProps, DataTableSortOrder, DataTableSortState } from './types'
import { computed, getCurrentInstance, provide, ref, useId, useSlots, watch } from 'vue'
import { TxCheckbox } from '../../checkbox'
import { TxEmptyState } from '../../empty-state'
import { TxSkeleton } from '../../skeleton'
import { TxSpinner } from '../../spinner'
import { DATA_TABLE_FILTER_CONTEXT } from './context'
import TxDataTableColumnFilter from './TxDataTableColumnFilter.vue'
import { DATA_TABLE_DEFAULT_LABELS } from './types'
import { getCellValue, useDataTableData } from './use-data-table-data'
import { useDataTableLayout } from './use-data-table-layout'

defineOptions({ name: 'TxDataTable' })

// The rendered widths of `.tx-data-table__th--select` / `--expand` in the style
// block. A fixed-left column sticks after them, so they stand in for the measured
// widths until the first layout pass.
const SELECT_COLUMN_WIDTH = 42
const EXPAND_COLUMN_WIDTH = 40

// Bars of one width read as a striped block rather than as rows of text, so the
// skeleton's bar width steps through this sequence by row and column. Fixed rather
// than random: a random width would differ between the server render and hydration.
const SKELETON_BAR_WIDTHS = [72, 88, 64, 80, 60, 90, 68]

const props = withDefaults(defineProps<DataTableProps<any>>(), {
  columns: () => [],
  data: () => [],
  loading: false,
  loadingVariant: 'overlay',
  skeletonRows: 5,
  emptyText: 'No data',
  striped: false,
  bordered: false,
  hover: true,
  interactiveRows: false,
  selectable: false,
  selectedKeys: () => [],
  expandable: false,
  defaultExpandedKeys: () => [],
  expandLabel: 'Expand row',
  collapseLabel: 'Collapse row',
  sortOnClient: true,
  sortCycle: 'tri',
  tableLayout: 'auto',
  nowrap: false,
  scrollX: false,
  stickyHeader: false,
  stickyFooter: false,
  highlightSelected: false,
  filterOnClient: true,
  autoStickyActions: true,
})
const emit = defineEmits<DataTableEmits<any>>()

const slots = useSlots()

const labels = computed<DataTableLabels>(() => ({ ...DATA_TABLE_DEFAULT_LABELS, ...props.labels }))

// A row is keyboard-interactive when explicitly opted in, or whenever a rowClick
// listener is attached — so the documented rowClick event is reachable by keyboard
// (Tab + Enter/Space), not only by mouse. rowClick is a declared emit, so its
// listener is read from the component vnode rather than $attrs.
const instance = getCurrentInstance()
const rowInteractive = computed(() => props.interactiveRows || !!instance?.vnode.props?.onRowClick)

const localSort = ref<DataTableSortState | null>(props.defaultSort ?? null)

watch(
  // Track the sort by value, not by object reference. Consumers routinely pass
  // an inline `:default-sort="{ ... }"` literal, so any unrelated parent
  // re-render produces a brand-new object; a reference watcher would then
  // silently roll a user's active sort back to the default on every render.
  [() => props.defaultSort?.key, () => props.defaultSort?.order],
  () => {
    const next = props.defaultSort
    if (!next) {
      localSort.value = null
      return
    }
    localSort.value = next
  },
)

const selectedSet = computed(() => new Set(props.selectedKeys ?? []))

function getRowKey(row: any, index: number): DataTableKey {
  if (typeof props.rowKey === 'function')
    return props.rowKey(row, index)
  if (typeof props.rowKey === 'string' && props.rowKey)
    return row?.[props.rowKey] ?? index
  return index
}

const rowKeys = computed(() => props.data.map((row, index) => getRowKey(row, index)))

const allSelected = computed(() => {
  if (!rowKeys.value.length)
    return false
  return rowKeys.value.every(key => selectedSet.value.has(key))
})

// A partial selection: the select-all box reports `mixed` rather than claiming
// "nothing is selected" while several rows plainly are.
const someSelected = computed(() => {
  if (allSelected.value)
    return false
  return rowKeys.value.some(key => selectedSet.value.has(key))
})

// Supplying `sort` — even as null — hands the state to the parent. `undefined`
// keeps the component in the original uncontrolled mode seeded by defaultSort.
const isSortControlled = computed(() => props.sort !== undefined)
const sortState = computed(() => (isSortControlled.value ? props.sort ?? null : localSort.value))

function normalizeSortOrder(order: DataTableSortOrder): DataTableSortOrder {
  if (order === 'asc' || order === 'desc')
    return order
  return null
}

function setSort(next: DataTableSortState | null) {
  if (!isSortControlled.value)
    localSort.value = next
  emit('update:sort', next)
  emit('sortChange', next)
}

function toggleSort(column: DataTableColumn) {
  if (!column.sortable)
    return
  const current = sortState.value
  if (!current || current.key !== column.key) {
    setSort({ key: column.key, order: 'asc' })
    return
  }
  const order = normalizeSortOrder(current.order)
  if (order === 'asc')
    setSort({ key: column.key, order: 'desc' })
  else if (order === 'desc')
    setSort(props.sortCycle === 'bi' ? { key: column.key, order: 'asc' } : null)
  else
    setSort({ key: column.key, order: 'asc' })
}

function getColumnSortOrder(column: DataTableColumn): DataTableSortOrder {
  const current = sortState.value
  return current?.key === column.key ? normalizeSortOrder(current.order) : null
}

function headerSlotProps(column: DataTableColumn): DataTableHeaderSlotProps {
  const order = getColumnSortOrder(column)
  return {
    column,
    sorted: order !== null,
    order,
    toggle: () => toggleSort(column),
  }
}

function getColumnAriaSort(column: DataTableColumn): 'ascending' | 'descending' | 'none' | undefined {
  if (!column.sortable)
    return undefined
  const order = getColumnSortOrder(column)
  if (!order)
    return 'none'
  return order === 'desc' ? 'descending' : 'ascending'
}

const tableData = useDataTableData(props, sortState, emit)
const { effectiveColumns, displayRows, isColumnFiltered } = tableData

// Each filterable header renders its own control, which reads and writes the
// filter state kept here.
provide(DATA_TABLE_FILTER_CONTEXT, { ...tableData, labels })

// --- Loading ---------------------------------------------------------------
// Anything but an explicit `skeleton` or `shimmer` keeps the overlay, so a
// mistyped variant still shows that the table is busy.
const isRowLoading = computed(() => props.loading && (props.loadingVariant === 'skeleton' || props.loadingVariant === 'shimmer'))
const isShimmer = computed(() => props.loading && props.loadingVariant === 'shimmer')
const showOverlay = computed(() => props.loading && !isRowLoading.value)
// Placeholder rows only stand in for rows that do not exist yet. A refresh keeps
// the rows on screen and says so with the bar under the header, or the bands.
const showSkeleton = computed(() => isRowLoading.value && !displayRows.value.length)
const showRefreshBar = computed(() => props.loading && props.loadingVariant === 'skeleton' && displayRows.value.length > 0)

const skeletonRowCount = computed(() => {
  const count = Math.floor(Number(props.skeletonRows))
  return Number.isFinite(count) ? Math.max(1, count) : 5
})

function skeletonBarWidth(row: number, column: number): string {
  return `${SKELETON_BAR_WIDTHS[(row * 5 + column * 3) % SKELETON_BAR_WIDTHS.length] ?? 72}%`
}

// The bar follows the column's alignment, so a right-aligned figure column keeps
// its placeholder at the right edge. Inline because it is one value per column.
function skeletonBarStyle(column: DataTableColumn): Record<string, string> | undefined {
  if (column.align === 'right')
    return { alignItems: 'flex-end' }
  if (column.align === 'center')
    return { alignItems: 'center' }
  return undefined
}

function toggleRow(key: DataTableKey) {
  const next = new Set(selectedSet.value)
  if (next.has(key))
    next.delete(key)
  else
    next.add(key)
  const updated = Array.from(next)
  emit('update:selectedKeys', updated)
  emit('selectionChange', updated)
}

function toggleAll() {
  const next = allSelected.value ? [] : rowKeys.value
  emit('update:selectedKeys', next)
  emit('selectionChange', next)
}

// --- Row expansion ---------------------------------------------------------
// Same controlled/uncontrolled split as `sort`: an inline `:default-expanded-keys`
// literal must not roll the reader's toggles back on every parent render, so the
// watch tracks the key list by value rather than by array identity.
const localExpandedKeys = ref<DataTableKey[]>([...(props.defaultExpandedKeys ?? [])])
const defaultExpandedSignature = computed(() =>
  (props.defaultExpandedKeys ?? []).map(key => String(key)).join('\u0000'),
)

watch(defaultExpandedSignature, () => {
  localExpandedKeys.value = [...(props.defaultExpandedKeys ?? [])]
})

const isExpandControlled = computed(() => props.expandedKeys !== undefined)
const expandedSet = computed(
  () => new Set(isExpandControlled.value ? (props.expandedKeys ?? []) : localExpandedKeys.value),
)

const tableId = useId()

function detailRowId(row: any, index: number) {
  return `${tableId}-detail-${getRowKey(row, index)}`
}

function isRowExpandable(row: any, index: number): boolean {
  return props.rowExpandable ? props.rowExpandable(row, index) : true
}

function isRowExpanded(row: any, index: number): boolean {
  if (!props.expandable || !isRowExpandable(row, index))
    return false
  return expandedSet.value.has(getRowKey(row, index))
}

function toggleExpand(row: any, index: number) {
  if (!isRowExpandable(row, index))
    return
  const key = getRowKey(row, index)
  const next = new Set(expandedSet.value)
  const expanded = !next.has(key)
  if (expanded)
    next.add(key)
  else
    next.delete(key)

  const updated = Array.from(next)
  if (!isExpandControlled.value)
    localExpandedKeys.value = updated
  emit('update:expandedKeys', updated)
  emit('expand', { row, index, expanded })
}

function formatCell(row: any, column: DataTableColumn, index: number): string {
  const value = getCellValue(row, column)
  if (column.format)
    return column.format(value, row, index)
  if (value == null || value === '')
    return '—'
  if (typeof value === 'object' && value && 'label' in value)
    return String(value.label)
  return String(value)
}

function toCssUnit(value: string | number | undefined): string | undefined {
  if (value === undefined)
    return undefined
  return typeof value === 'number' ? `${value}px` : value
}

// --- Column layout ---------------------------------------------------------
// Header cells run [expand][select][...columns]; a column's position in that
// row is how its measured width and sticky offset are looked up.

function getFixedSide(column: DataTableColumn): 'left' | 'right' | null {
  if (column.fixed === true || column.fixed === 'left')
    return 'left'
  if (column.fixed === 'right')
    return 'right'
  return null
}

function getStickyWidth(column: DataTableColumn): number {
  const value = column.width ?? column.minWidth
  if (typeof value === 'number')
    return value
  if (typeof value !== 'string')
    return 0
  const match = value.trim().match(/^(\d+(?:\.\d+)?)px$/)
  return match ? Number(match[1]) : 0
}

const leadingCells = computed(() => (props.expandable ? 1 : 0) + (props.selectable ? 1 : 0))
const hasFixedColumns = computed(() => effectiveColumns.value.some(column => Boolean(getFixedSide(column))))
// The expand and select columns pin along with a fixed-left column: left to
// scroll, they would leave a gap the content shows through beside it.
const pinsLeading = computed(() => effectiveColumns.value.some(column => getFixedSide(column) === 'left'))

const stickyCells = computed(() => {
  const cells: number[] = []
  if (pinsLeading.value) {
    for (let position = 0; position < leadingCells.value; position++)
      cells.push(position)
  }
  effectiveColumns.value.forEach((column, index) => {
    if (getFixedSide(column))
      cells.push(leadingCells.value + index)
  })
  return cells
})

// Every column hugs its content once nothing makes it wrap: a nowrap column
// without a declared width collapses to its widest cell. Some column has to take
// the space left over, so when none is free to, the first text column does.
const hugColumns = computed(() => {
  const hug = new Set<string>()
  if (props.tableLayout !== 'auto')
    return hug
  let absorbs = false
  for (const column of effectiveColumns.value) {
    if (column.width !== undefined)
      continue
    if (!column.auto && column.minWidth === undefined && (props.nowrap || column.nowrap))
      hug.add(column.key)
    else
      absorbs = true
  }
  if (!absorbs && hug.size) {
    const candidates = effectiveColumns.value.filter(column => hug.has(column.key))
    const grow = candidates.find(column => !column.type || column.type === 'text')
      ?? candidates.find(column => column.type !== 'actions')
      ?? candidates[0]!
    hug.delete(grow.key)
  }
  return hug
})

// Sticky cells need a scroll container, and a sticky <th> loses its borders
// under `border-collapse: collapse`. Both switches ride on this one class so
// tables that opt out render exactly as before.
const isStickyShell = computed(() =>
  props.stickyHeader || props.stickyFooter || props.maxHeight !== undefined,
)

const shellStyle = computed(() => {
  if (props.maxHeight === undefined)
    return undefined
  return { maxHeight: toCssUnit(props.maxHeight) }
})

const isScroller = computed(() => props.scrollX || isStickyShell.value)

const rootRef = ref<HTMLElement | null>(null)
const tableRef = ref<HTMLTableElement | null>(null)

const {
  cellWidths,
  overflowLeft,
  overflowRight,
  viewportHeight,
  fillRows,
  shimmerLayer,
  track,
} = useDataTableLayout({
  root: rootRef,
  table: tableRef,
  stickyCells: () => stickyCells.value,
  scroller: () => isScroller.value,
  overlay: () => showOverlay.value,
  placeholders: () => showSkeleton.value,
  shimmer: () => isShimmer.value,
})

// A host-sized table fills its height with placeholders instead of leaving a
// blank band under five rows.
const placeholderRowCount = computed(() => Math.max(skeletonRowCount.value, fillRows.value))

track(() => [
  stickyCells.value.join(),
  hugColumns.value.size,
  displayRows.value,
  expandedSet.value.size,
  props.loading,
  props.loadingVariant,
  placeholderRowCount.value,
])

const fixedLayout = computed(() => {
  const offsets = new Map<number, string>()
  let leftEdge = -1
  let rightEdge = -1
  const widthAt = (position: number, fallback: number) => cellWidths.value[position] ?? fallback

  let left = 0
  if (pinsLeading.value) {
    for (let position = 0; position < leadingCells.value; position++) {
      offsets.set(position, `${left}px`)
      const expandCell = props.expandable && position === 0
      left += widthAt(position, expandCell ? EXPAND_COLUMN_WIDTH : SELECT_COLUMN_WIDTH)
    }
  }
  effectiveColumns.value.forEach((column, index) => {
    if (getFixedSide(column) !== 'left')
      return
    const position = leadingCells.value + index
    offsets.set(position, `${left}px`)
    left += widthAt(position, getStickyWidth(column))
    leftEdge = position
  })

  let right = 0
  for (let index = effectiveColumns.value.length - 1; index >= 0; index--) {
    const column = effectiveColumns.value[index]!
    if (getFixedSide(column) !== 'right')
      continue
    const position = leadingCells.value + index
    offsets.set(position, `${right}px`)
    right += widthAt(position, getStickyWidth(column))
    rightEdge = position
  }

  return { offsets, leftEdge, rightEdge }
})

function leadingCellStyle(position: number) {
  return pinsLeading.value ? { left: fixedLayout.value.offsets.get(position) ?? '0px' } : undefined
}

function columnStyle(column: DataTableColumn, position: number): Record<string, string> {
  const style: Record<string, string> = {}
  if (column.auto)
    style.width = 'auto'
  else if (column.width !== undefined)
    style.width = toCssUnit(column.width) ?? ''
  if (column.minWidth !== undefined)
    style.minWidth = toCssUnit(column.minWidth) ?? ''
  if (column.maxWidth !== undefined)
    style.maxWidth = toCssUnit(column.maxWidth) ?? ''
  if (column.align)
    style.textAlign = column.align

  const fixedSide = getFixedSide(column)
  if (fixedSide)
    style[fixedSide] = fixedLayout.value.offsets.get(position) ?? '0px'

  return style
}

function columnClass(column: DataTableColumn, type: 'header' | 'cell', position: number) {
  const fixedSide = getFixedSide(column)
  return [
    type === 'header' ? column.headerClass : column.cellClass,
    {
      'is-auto': column.auto,
      'is-hug': hugColumns.value.has(column.key),
      'is-fixed': Boolean(fixedSide),
      'is-fixed-left': fixedSide === 'left',
      'is-fixed-right': fixedSide === 'right',
      'is-fixed-left-edge': fixedLayout.value.leftEdge === position,
      'is-fixed-right-edge': fixedLayout.value.rightEdge === position,
      'is-nowrap': props.nowrap || column.nowrap,
      'is-sortable': type === 'header' && column.sortable,
      'is-sorted': type === 'header' && sortState.value?.key === column.key,
      'has-filter': type === 'header' && Boolean(column.filter),
      'is-filtered': isColumnFiltered(column.key),
      [`is-align-${column.align}`]: type === 'header' && Boolean(column.align),
      [`is-type-${column.type}`]: Boolean(column.type),
      'is-numeric': column.type === 'number',
    },
  ]
}

const colspan = computed(
  () => effectiveColumns.value.length + leadingCells.value,
)

// Plain functions, not computeds: slot presence is read at render time, so a
// parent that starts passing a footer slot gets a footer without a key change.
function hasFooter(): boolean {
  return Boolean(slots.footer) || effectiveColumns.value.some(column => Boolean(slots[`footer-${column.key}`]))
}

function rowClasses(row: any, index: number) {
  return [
    {
      'is-interactive': rowInteractive.value,
      'is-selected': selectedSet.value.has(getRowKey(row, index)),
      'is-expanded': isRowExpanded(row, index),
      // With detail rows in the tbody, `tr:nth-child(odd)` no longer lines up
      // with the data rows; the stripe moves onto the row itself.
      'is-stripe': props.expandable && props.striped && index % 2 === 0,
    },
    props.rowClass?.(row, index),
  ]
}

// The veil pins to the visible part of the root, so a tall or scrolled table is
// covered where the reader is looking. Before the first measurement it falls
// back to covering the root's box.
const overlayStyle = computed(() => {
  const height = viewportHeight.value
  return height ? { position: 'sticky' as const, height: `${height}px`, marginBottom: `-${height}px` } : undefined
})

function emitRowClick(row: any, index: number) {
  emit('rowClick', { row, index })
}

function handleRowKeydown(event: KeyboardEvent, row: any, index: number) {
  if (!rowInteractive.value || event.target !== event.currentTarget)
    return
  if (event.key !== 'Enter' && event.key !== ' ')
    return

  event.preventDefault()
  emitRowClick(row, index)
}
</script>

<template>
  <div
    ref="rootRef"
    class="tx-data-table"
    :class="{
      'is-striped': striped,
      'is-bordered': bordered,
      'is-hover': hover,
      'is-nowrap': nowrap,
      'has-fixed-columns': hasFixedColumns,
      'has-overflow-left': overflowLeft,
      'has-overflow-right': overflowRight,
      'is-scroll-x': scrollX,
      'is-sticky-shell': isStickyShell,
      'is-scroller': isScroller,
      'has-sticky-header': stickyHeader,
      'has-sticky-footer': stickyFooter,
      'is-highlight-selected': highlightSelected,
      'is-expandable': expandable,
      'is-shimmer': isShimmer,
      [`is-layout-${tableLayout}`]: true,
    }"
    :style="shellStyle"
  >
    <div v-if="showOverlay" class="tx-data-table__loading" :style="overlayStyle" aria-live="polite">
      <TxSpinner :size="20" />
    </div>

    <!-- One band per visible row, laid over the table at its measured rows. -->
    <div
      v-if="shimmerLayer"
      class="tx-data-table__shimmer"
      :style="{ top: `${shimmerLayer.top}px`, left: `${shimmerLayer.left}px`, width: `${shimmerLayer.width}px`, height: `${shimmerLayer.height}px` }"
      aria-hidden="true"
    >
      <span
        v-for="band in shimmerLayer.bands"
        :key="band.index"
        class="tx-data-table__shimmer-row"
        :style="{ 'top': `${band.top}px`, 'height': `${band.height}px`, '--tx-data-table-shimmer-index': band.index % 16 }"
      />
    </div>

    <table ref="tableRef" class="tx-data-table__table" :style="{ tableLayout }" :aria-busy="loading">
      <thead>
        <tr>
          <th
            v-if="expandable"
            class="tx-data-table__th tx-data-table__th--expand"
            :class="pinsLeading && 'is-fixed is-fixed-left'"
            :style="leadingCellStyle(0)"
            scope="col"
          />
          <th
            v-if="selectable"
            class="tx-data-table__th tx-data-table__th--select"
            :class="pinsLeading && 'is-fixed is-fixed-left'"
            :style="leadingCellStyle(leadingCells - 1)"
            scope="col"
          >
            <TxCheckbox
              :model-value="allSelected"
              :indeterminate="someSelected"
              aria-label="Select all"
              @update:model-value="toggleAll"
            />
          </th>
          <th
            v-for="(column, columnIndex) in effectiveColumns"
            :key="column.key"
            class="tx-data-table__th"
            scope="col"
            :class="columnClass(column, 'header', leadingCells + columnIndex)"
            :style="columnStyle(column, leadingCells + columnIndex)"
            :aria-sort="getColumnAriaSort(column)"
          >
            <div v-if="column.sortable || column.filter" class="tx-data-table__th-inner">
              <!-- The button's ::after stretches over the whole cell, so the
                   header is one hit area; the filter button sits above it. -->
              <button
                v-if="column.sortable"
                type="button"
                class="tx-data-table__sort-button"
                @click="toggleSort(column)"
              >
                <slot :name="`header-${column.key}`" v-bind="headerSlotProps(column)">
                  {{ column.title }}
                </slot>
                <svg
                  class="tx-data-table__sort"
                  :class="getColumnSortOrder(column) && `is-${getColumnSortOrder(column)}`"
                  viewBox="0 0 16 16"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5 6.5 8 3.5l3 3" />
                  <path d="M5 9.5l3 3 3-3" />
                </svg>
              </button>
              <slot v-else :name="`header-${column.key}`" v-bind="headerSlotProps(column)">
                {{ column.title }}
              </slot>

              <TxDataTableColumnFilter v-if="column.filter" :column="column">
                <template v-if="$slots[`filter-${column.key}`]" #default="scope">
                  <slot :name="`filter-${column.key}`" v-bind="scope" />
                </template>
              </TxDataTableColumnFilter>
            </div>
            <slot v-else :name="`header-${column.key}`" v-bind="headerSlotProps(column)">
              {{ column.title }}
            </slot>
          </th>
        </tr>
      </thead>
      <!-- A row group of its own, so the bar neither adds height nor shifts the
           body's `nth-child` stripes. The cell is the bar's containing block. -->
      <tbody v-if="showRefreshBar" class="tx-data-table__refresh" aria-hidden="true">
        <tr>
          <td :colspan="colspan" style="position: relative; padding: 0">
            <span class="tx-data-table__refresh-bar" />
          </td>
        </tr>
      </tbody>
      <tbody>
        <template v-if="showSkeleton">
          <tr
            v-for="row in placeholderRowCount"
            :key="`skeleton-${row}`"
            class="tx-data-table__row tx-data-table__row--skeleton"
            :class="{ 'is-stripe': expandable && striped && row % 2 === 1 }"
            aria-hidden="true"
          >
            <td
              v-if="expandable"
              class="tx-data-table__cell tx-data-table__cell--expand"
              :class="pinsLeading && 'is-fixed is-fixed-left'"
              :style="leadingCellStyle(0)"
            />
            <td
              v-if="selectable"
              class="tx-data-table__cell tx-data-table__cell--select"
              :class="pinsLeading && 'is-fixed is-fixed-left'"
              :style="leadingCellStyle(leadingCells - 1)"
            >
              <TxSkeleton class="tx-data-table__skeleton is-check" :width="18" :height="18" :radius="6" />
            </td>
            <td
              v-for="(column, columnIndex) in effectiveColumns"
              :key="column.key"
              class="tx-data-table__cell"
              :class="columnClass(column, 'cell', leadingCells + columnIndex)"
              :style="columnStyle(column, leadingCells + columnIndex)"
            >
              <TxSkeleton
                class="tx-data-table__skeleton"
                :style="skeletonBarStyle(column)"
                :width="skeletonBarWidth(row, columnIndex)"
                :height="10"
                :radius="4"
              />
            </td>
          </tr>
        </template>
        <template v-for="(row, index) in displayRows" :key="getRowKey(row, index)">
          <tr
            class="tx-data-table__row"
            :class="rowClasses(row, index)"
            :tabindex="rowInteractive ? 0 : undefined"
            @click="emitRowClick(row, index)"
            @keydown="handleRowKeydown($event, row, index)"
          >
            <td
              v-if="expandable"
              class="tx-data-table__cell tx-data-table__cell--expand"
              :class="pinsLeading && 'is-fixed is-fixed-left'"
              :style="leadingCellStyle(0)"
              @click.stop
            >
              <button
                v-if="isRowExpandable(row, index)"
                type="button"
                class="tx-data-table__expand-toggle"
                :class="{ 'is-expanded': isRowExpanded(row, index) }"
                :aria-expanded="isRowExpanded(row, index)"
                :aria-controls="detailRowId(row, index)"
                :aria-label="isRowExpanded(row, index) ? collapseLabel : expandLabel"
                @click="toggleExpand(row, index)"
              >
                <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                  <path fill="currentColor" d="M9 6l6 6-6 6z" />
                </svg>
              </button>
            </td>
            <td
              v-if="selectable"
              class="tx-data-table__cell tx-data-table__cell--select"
              :class="pinsLeading && 'is-fixed is-fixed-left'"
              :style="leadingCellStyle(leadingCells - 1)"
              @click.stop
            >
              <TxCheckbox
                :model-value="selectedSet.has(getRowKey(row, index))"
                aria-label="Select row"
                @update:model-value="() => toggleRow(getRowKey(row, index))"
              />
            </td>
            <td
              v-for="(column, columnIndex) in effectiveColumns"
              :key="column.key"
              class="tx-data-table__cell"
              :class="columnClass(column, 'cell', leadingCells + columnIndex)"
              :style="columnStyle(column, leadingCells + columnIndex)"
            >
              <slot
                :name="`cell-${column.key}`"
                :row="row"
                :column="column"
                :value="getCellValue(row, column)"
                :index="index"
              >
                <span v-if="column.type === 'tag'" class="tx-data-table__tag-pill">
                  {{ formatCell(row, column, index) }}
                </span>
                <span v-else-if="column.type === 'source'" class="tx-data-table__source-badge" :title="String(getCellValue(row, column) ?? '')">
                  {{ formatCell(row, column, index) }}
                </span>
                <span v-else-if="column.type === 'datetime' || column.type === 'date'" class="tx-data-table__datetime" :title="String(getCellValue(row, column) ?? '')">
                  <svg class="tx-data-table__time-icon" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                    <path fill="currentColor" d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7-.8 1.3z" />
                  </svg>
                  <span>{{ formatCell(row, column, index) }}</span>
                </span>
                <span v-else-if="column.type === 'number'" class="tx-data-table__number">
                  {{ formatCell(row, column, index) }}
                </span>
                <template v-else>
                  {{ formatCell(row, column, index) }}
                </template>
              </slot>
            </td>
          </tr>
          <tr
            v-if="isRowExpanded(row, index)"
            :id="detailRowId(row, index)"
            class="tx-data-table__row tx-data-table__row--detail"
          >
            <td :colspan="colspan" class="tx-data-table__cell tx-data-table__cell--detail">
              <slot name="expanded" :row="row" :index="index" />
            </td>
          </tr>
        </template>
        <!-- With nothing to show, the veil still needs a body to cover: the empty
             state that follows it, laid out but unseen, so the table keeps its
             height when the load comes back empty. -->
        <tr v-if="showOverlay && !displayRows.length" class="tx-data-table__loading-row" aria-hidden="true">
          <td :colspan="colspan">
            <slot name="empty">
              <TxEmptyState variant="no-data" :title="emptyText" size="small" layout="vertical" />
            </slot>
          </td>
        </tr>
        <tr v-if="!displayRows.length && !loading">
          <td :colspan="colspan" class="tx-data-table__empty">
            <slot name="empty">
              <TxEmptyState variant="no-data" :title="emptyText" size="small" layout="vertical" />
            </slot>
          </td>
        </tr>
      </tbody>
      <tfoot v-if="hasFooter()">
        <tr class="tx-data-table__footer-row">
          <!-- The `footer` slot supplies the cells itself, so a summary row can
               span columns; `footer-<key>` fills one cell per column. -->
          <slot v-if="$slots.footer" name="footer" :columns="effectiveColumns" :data="data" :selected-keys="selectedKeys" />
          <template v-else>
            <td
              v-if="expandable"
              class="tx-data-table__footer-cell tx-data-table__footer-cell--expand"
              :class="pinsLeading && 'is-fixed is-fixed-left'"
              :style="leadingCellStyle(0)"
            />
            <td
              v-if="selectable"
              class="tx-data-table__footer-cell tx-data-table__footer-cell--select"
              :class="pinsLeading && 'is-fixed is-fixed-left'"
              :style="leadingCellStyle(leadingCells - 1)"
            />
            <td
              v-for="(column, columnIndex) in effectiveColumns"
              :key="column.key"
              class="tx-data-table__footer-cell"
              :class="columnClass(column, 'cell', leadingCells + columnIndex)"
              :style="columnStyle(column, leadingCells + columnIndex)"
            >
              <slot :name="`footer-${column.key}`" :column="column" :data="data" />
            </td>
          </template>
        </tr>
      </tfoot>
    </table>
  </div>
</template>

<!-- BEM names isolate the stylesheet, including teleported filter content.
     Generic table selectors stay under the owned table, never a slot's nested table. -->
<style lang="scss">
@use '../../../style/mixins.scss' as *;

/* Stacking inside the root, all contained by `isolation`: cells 1, shimmer bands 2,
   fixed header cells 3, refresh bar 4, pinned header 5, pinned footer corner 6,
   pinned header corner 7, loading veil 9. */
.tx-data-table {
  position: relative;
  isolation: isolate;
  width: 100%;
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid transparent;

  &.is-bordered {
    border-color: var(--tx-border-color-lighter, #ebeef5);
  }

  // Without its own scroll container the component leans on an ancestor to
  // scroll, and clipping would hide the fixed columns. Once it does scroll
  // (scrollX / sticky shell) the overflow belongs here instead.
  &.has-fixed-columns:not(.is-scroller) {
    overflow: visible;
  }

  &.is-scroll-x {
    overflow-x: auto;
  }

  &.is-sticky-shell {
    overflow: auto;
  }

  // A scrollbar with a lane of its own: macOS overlay scrollbars are drawn over
  // the content, so the vertical one lay across a right-pinned column. The lane
  // takes the table's surface rather than showing the page through it.
  &.is-scroller {
    background: var(--tx-bg-color, #fff);

    @include custom-scrollbar(8px, transparent, var(--tx-border-color, #dcdfe6));

    &::-webkit-scrollbar-corner {
      background: transparent;
    }
  }
}

.tx-data-table__table {
  width: 100%;
  border-collapse: collapse;
  color: var(--tx-text-color-primary, #303133);
  background: var(--tx-bg-color, #fff);
}

.tx-data-table__th,
.tx-data-table__cell {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid var(--tx-border-color-lighter, #ebeef5);
  font-size: 13px;
  line-height: 1.5;
}

// The shell rounds its corners and clips, so a separator on the final row runs
// straight into the curve and reads as a stray line under the table. `> :last-child`
// is whichever section actually ends the table, so a summary `tfoot` keeps the
// separator that divides it from the body.
.tx-data-table__table > :last-child > tr:last-child > :is(td, th) {
  border-bottom: 0;
}

:is(.tx-data-table__th, .tx-data-table__cell).is-nowrap,
.tx-data-table.is-nowrap :is(.tx-data-table__th, .tx-data-table__cell) {
  white-space: nowrap;
}

// A nowrap column without a declared width shrinks to its widest cell; the
// columns left free share whatever the table has over.
:is(.tx-data-table__th, .tx-data-table__cell, .tx-data-table__footer-cell).is-hug {
  width: 1px;
}

:is(.tx-data-table__th, .tx-data-table__cell, .tx-data-table__footer-cell).is-fixed {
  position: sticky;
  z-index: 1;
}

// A fixed cell is opaque to cover what scrolls beneath it, so the row's tint is
// layered onto it explicitly — otherwise hover, stripes and selection would stop
// short of the pinned columns.
.tx-data-table__cell.is-fixed {
  background:
    linear-gradient(var(--tx-data-table-row-tint, transparent), var(--tx-data-table-row-tint, transparent)),
    var(--tx-bg-color, #fff);
}

.tx-data-table__th.is-fixed {
  z-index: 3;
}

// The edge of a pinned group gets its line only while content is actually
// hidden beneath it. A table that leaves scrolling to an ancestor cannot tell,
// so it always draws the line.
.tx-data-table:is(.has-overflow-left, :not(.is-scroller)) .is-fixed-left-edge {
  box-shadow: inset -1px 0 0 var(--tx-border-color-lighter, #ebeef5);
}

.tx-data-table:is(.has-overflow-right, :not(.is-scroller)) .is-fixed-right-edge {
  box-shadow: inset 1px 0 0 var(--tx-border-color-lighter, #ebeef5);
}

.tx-data-table__th {
  position: relative;
  font-weight: var(--tx-font-weight-semibold, 600);
  color: var(--tx-text-color-regular, #606266);
  background: var(--tx-fill-color-lighter, #fafafa);
  user-select: none;
  white-space: nowrap;
}

/* The checkbox and toggle columns are exactly their width; a fixed-left column
   sticks after them by it (mirrored in the script for the first frame). A cell's
   width gives way once the table overflows, so min-width holds it there too.
   Their controls centre on the row instead of sitting on the text baseline,
   which lifted them above the middle and made the row taller than its text. */
.tx-data-table__table :is(.tx-data-table__th--select, .tx-data-table__cell--select, .tx-data-table__footer-cell--select) {
  width: 42px;
  min-width: 42px;
  padding-inline: 0;
  text-align: center;
  line-height: 0;
}

.tx-data-table__table :is(.tx-data-table__th--expand, .tx-data-table__cell--expand, .tx-data-table__footer-cell--expand) {
  width: 40px;
  min-width: 40px;
  padding: 0;
  text-align: center;
  line-height: 0;
}

.tx-data-table__table :is(.tx-data-table__th--select, .tx-data-table__cell--select, .tx-data-table__cell--expand) > * {
  vertical-align: middle;
}

/* Header ------------------------------------------------------------------ */

.tx-data-table__th-inner,
.tx-data-table__sort-button {
  display: flex;
  align-items: center;
  gap: 4px;
}

.tx-data-table__th.is-align-center .tx-data-table__th-inner {
  justify-content: center;
}

// A right-aligned column mirrors its header, so the title — not the icons —
// lines up with the figures below it.
.tx-data-table__th.is-align-right :is(.tx-data-table__th-inner, .tx-data-table__sort-button) {
  flex-direction: row-reverse;
}

.tx-data-table__sort-button,
.tx-data-table__expand-toggle,
.tx-data-table__filter-trigger {
  appearance: none;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.tx-data-table__expand-toggle,
.tx-data-table__filter-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
}

.tx-data-table__sort-button {
  border-radius: 4px;

  &::after {
    content: '';
    position: absolute;
    inset: 0;
  }
}

.tx-data-table__th.is-sortable:hover {
  background: var(--tx-fill-color-light, #f5f7fa);
}

:is(.tx-data-table__sort-button, .tx-data-table__expand-toggle, .tx-data-table__filter-trigger):focus-visible {
  outline: 2px solid var(--tx-color-primary, #409eff);
  outline-offset: 2px;
}

.tx-data-table__row.is-interactive:focus-visible {
  outline: 2px solid var(--tx-color-primary, #409eff);
  outline-offset: -2px;
}

.tx-data-table__sort,
.tx-data-table__filter-trigger,
.tx-data-table__time-icon {
  flex: none;
  color: var(--tx-text-color-placeholder, #a8abb2);
}

.tx-data-table__sort:is(.is-asc, .is-desc) path {
  opacity: 0.35;
}

.tx-data-table__sort.is-asc path:first-child,
.tx-data-table__sort.is-desc path:last-child {
  opacity: 1;
  stroke: var(--tx-color-primary, #409eff);
}

// Lifted over the sort button's stretched hit area; the negative margin keeps
// its 22px box from making a filterable header taller than the rest.
.tx-data-table__filter-trigger {
  position: relative;
  z-index: 1;
  margin-block: -2px;

  &:hover,
  &.is-open {
    color: var(--tx-text-color-primary, #303133);
    background: var(--tx-fill-color, #f0f2f5);
  }

  &.is-active {
    color: var(--tx-color-primary, #409eff);
  }

  &.is-active svg {
    fill: currentColor;
  }
}

/* Filter panels: TuffEx menus and fields; only the arrangement lives here. */

.tx-data-table__filter-search {
  margin-bottom: 4px;
}

.tx-data-table__filter-count {
  color: var(--tx-text-color-secondary, #909399);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.tx-data-table__filter-form {
  display: grid;
  gap: 10px;
  width: 260px;
}

.tx-data-table__filter-range,
.tx-data-table__filter-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tx-data-table__filter-range {
  color: var(--tx-text-color-placeholder, #a8abb2);
}

/* The two fields split the row evenly; at their own 120px floor the pair and
   the dash between them would run past the panel's edge. The doubled class
   outranks the field's own scoped rule, whichever stylesheet loads last. */
.tx-data-table__filter-range > .tx-number-input.tx-number-input {
  flex: 1 1 0;
  min-width: 0;
}

.tx-data-table__filter-actions {
  justify-content: flex-end;
}

/* Expandable rows --------------------------------------------------------- */

.tx-data-table__expand-toggle {
  color: var(--tx-text-color-secondary, #909399);
  transition: transform 160ms ease;

  &:hover {
    color: var(--tx-text-color-primary, #303133);
    background: color-mix(in srgb, var(--tx-fill-color, #f0f2f5) 70%, transparent);
  }

  &.is-expanded {
    transform: rotate(90deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tx-data-table__expand-toggle {
    transition: none;
  }
}

.tx-data-table__row--detail > .tx-data-table__cell--detail {
  padding: 4px 12px 14px 40px;
  background: color-mix(in srgb, var(--tx-fill-color-lighter, #fafafa) 70%, transparent);
  color: var(--tx-text-color-regular, #606266);
}

/* Row tint ------------------------------------------------------------------ */

// One custom property carries the row's tint — stripe, then hover, then the
// selection, each later rule winning — and fixed cells read it too.
.tx-data-table__table > tbody > tr {
  background: var(--tx-data-table-row-tint, transparent);
}

// Detail rows live in the same tbody, so `nth-child(odd)` stops matching the
// data rows. An expandable table stripes off the row's own `is-stripe` class.
.tx-data-table.is-striped:not(.is-expandable) .tx-data-table__table > tbody > tr:nth-child(odd),
.tx-data-table.is-striped.is-expandable .tx-data-table__row.is-stripe {
  --tx-data-table-row-tint: color-mix(in srgb, var(--tx-fill-color-light, #f5f7fa) 60%, transparent);
}

// The fallback is the long-standing accent tint. The variable exists so a host
// with a different table language (a neutral-grey BUI records table, say) can
// repoint the hover without a prop or an override on `!important`.
.tx-data-table.is-hover .tx-data-table__table > tbody > tr:hover:not(.tx-data-table__row--detail) {
  --tx-data-table-row-tint: var(
    --tx-data-table-row-hover-bg,
    color-mix(in srgb, var(--tx-color-primary-light-9, #ecf5ff) 60%, transparent)
  );
}

.tx-data-table.is-highlight-selected .tx-data-table__table > tbody > tr.tx-data-table__row.is-selected {
  --tx-data-table-row-tint: var(
    --tx-data-table-row-selected-bg,
    color-mix(in srgb, var(--tx-color-primary, #409eff) 7%, transparent)
  );
}

.tx-data-table__row.is-interactive {
  cursor: pointer;
}

/* Loading ------------------------------------------------------------------ */

.tx-data-table__loading {
  position: absolute;
  inset: 0;
  z-index: 9;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: inherit;
  background: color-mix(in srgb, var(--tx-bg-color, #fff) 70%, transparent);
  backdrop-filter: blur(4px);

  // High contrast: an opaque veil, so the spinner never sits on the rows it covers.
  @include tx-when-high-contrast {
    background: var(--tx-bg-color, #fff);
    backdrop-filter: none;
  }
}

.tx-data-table__loading-row > td {
  visibility: hidden;
}

/* The bar sits in a box one line tall, inside the same cell padding as a loaded
   cell, so a placeholder row is exactly as tall as a one-line row of text. */
.tx-data-table__skeleton {
  height: 1lh;
  justify-content: center;
}

/* The selection column: a box of the checkbox's size, centred as the checkbox
   is, so a selectable placeholder row matches a selectable row too. */
.tx-data-table__skeleton.is-check {
  display: inline-flex;
  height: auto;
}

/* A placeholder takes no hover tint and no clicks. */
.tx-data-table__row--skeleton {
  pointer-events: none;
}

/* Under the shimmer the bars hold still and flat; the band does the moving. */
.tx-data-table.is-shimmer .tx-data-table__skeleton .tx-skeleton__item {
  animation: none;
  background: var(--tx-skeleton-base-color, var(--tx-skeleton-color, var(--tx-fill-color, #f0f2f5)));
}

.tx-data-table__shimmer {
  position: absolute;
  z-index: 2;
  pointer-events: none;
}

/* Each row clips its own band, so a band in flight never widens the scroll area.
   At rest (reduced motion) the band is a still wash across the whole row. */
.tx-data-table__shimmer-row {
  position: absolute;
  left: 0;
  width: 100%;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 100%;
    background: color-mix(in srgb, var(--tx-text-color-primary, #303133) 4%, transparent);
  }
}

/* Rows start one after another, so the light runs down the table; the index is
   set per row inline and wraps every 16 rows. */
@media (prefers-reduced-motion: no-preference) {
  .tx-data-table__shimmer-row::before {
    width: 40%;
    background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--tx-text-color-primary, #303133) 8%, transparent), transparent);
    translate: -100% 0;
    animation: tx-data-table-shimmer 1.6s ease-in-out calc(var(--tx-data-table-shimmer-index, 0) * 90ms) infinite;
  }
}

@keyframes tx-data-table-shimmer {
  60%,
  100% {
    translate: 250% 0;
  }
}

/* A refresh keeps the rows. Its bar lies over the header's bottom rule, from a
   zero-height row group of its own (the cell's two declarations are inline);
   z-index 4 is over fixed cells (1, 3) and under a pinned header (5). Under
   reduced motion it is a still, full line. It takes the physical left plus a
   width rather than both insets: with both set, a right-to-left page would
   anchor the travelling 40% bar at the right edge. */
.tx-data-table__refresh-bar {
  position: absolute;
  top: -1px;
  left: 0;
  z-index: 4;
  width: 100%;
  height: 2px;
  background: var(--tx-color-primary, #409eff);
  pointer-events: none;
}

/* 40% travelling 150% of its own width ends flush with the right edge, so the
   bar never leaves the table: no clipping, and no scrollbar on a scrolling shell. */
@media (prefers-reduced-motion: no-preference) {
  .tx-data-table__refresh-bar {
    width: 40%;
    animation: tx-data-table-refresh 0.9s ease-in-out infinite alternate;
  }
}

@keyframes tx-data-table-refresh {
  to {
    translate: 150% 0;
  }
}

.tx-data-table__empty,
.tx-data-table__loading-row > td {
  padding: 24px 12px;
  text-align: center;
  color: var(--tx-text-color-secondary, #909399);
}

/* Footer ------------------------------------------------------------------ */

// Footer slots render the consumer's cells; namespacing reaches them directly.
.tx-data-table__footer-row :is(td, th) {
  padding: 10px 12px;
  text-align: left;
  font-size: 13px;
  line-height: 1.5;
  color: var(--tx-text-color-regular, #606266);
  background: var(--tx-fill-color-lighter, #fafafa);
  border-top: 1px solid var(--tx-border-color-lighter, #ebeef5);
}

/* Sticky shell ------------------------------------------------------------ */

/* Collapsed borders are painted by the table, not the cell, so a sticky <th>
   loses its rules the moment it detaches and scrolls. Separate borders keep
   them — scoped to the shell so `bordered` / `striped` are untouched elsewhere. */
.tx-data-table.is-sticky-shell .tx-data-table__table {
  border-collapse: separate;
  border-spacing: 0;
}

.tx-data-table.is-sticky-shell.has-sticky-header .tx-data-table__th {
  position: sticky;
  top: 0;
  z-index: 5;
}

.tx-data-table.is-sticky-shell.has-sticky-footer .tx-data-table__footer-row :is(td, th) {
  position: sticky;
  bottom: 0;
  z-index: 4;
}

/* A cell that is pinned on both axes has to outrank whichever edge it crosses,
   so the corners sit above their own row or column. */
.tx-data-table.is-sticky-shell.has-sticky-header .tx-data-table__th.is-fixed {
  z-index: 7;
}

.tx-data-table.is-sticky-shell.has-sticky-footer .tx-data-table__footer-row td.is-fixed {
  z-index: 6;
}

/* Semantic cells ---------------------------------------------------------- */

.tx-data-table__tag-pill,
.tx-data-table__datetime {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  color: var(--tx-text-color-regular, #606266);
}

.tx-data-table__tag-pill {
  padding: 2px 8px;
  border-radius: 9999px;
  font-weight: var(--tx-font-weight-medium, 500);
  background: var(--tx-fill-color, #f0f2f5);
}

.tx-data-table__source-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: var(--tx-font-weight-medium, 500);
  background: var(--tx-fill-color-lighter, #fafafa);
  border: 1px solid var(--tx-border-color-lighter, #ebeef5);
  color: var(--tx-text-color-secondary, #909399);
}

.tx-data-table__datetime {
  gap: 4px;
  font-variant-numeric: tabular-nums;
}

.tx-data-table__number,
.tx-data-table__cell.is-numeric {
  font-variant-numeric: tabular-nums;
}
</style>
