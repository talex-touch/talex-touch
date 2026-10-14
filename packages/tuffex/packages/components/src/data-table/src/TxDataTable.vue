<script setup lang="ts">
import type { DataTableColumn, DataTableEmits, DataTableHeaderSlotProps, DataTableKey, DataTableProps, DataTableSortOrder, DataTableSortState } from './types'
import { computed, getCurrentInstance, ref, useId, useSlots, watch } from 'vue'
import { TxCheckbox } from '../../checkbox'
import { TxEmptyState } from '../../empty-state'
import { TxPopover } from '../../popover'
import { TxSkeleton } from '../../skeleton'
import { TxSpinner } from '../../spinner'
import { DATE_FILTER_PRESETS, getCellValue, useDataTableData } from './use-data-table-data'
defineOptions({ name: 'TxDataTable' })

// Kept in step with `.tx-data-table__th--select` / `--expand` in the style block:
// a fixed-left column sticks after them, so their widths are part of the offset.
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

function headerSlotProps(column: DataTableColumn): DataTableHeaderSlotProps {
  const current = sortState.value
  const active = current?.key === column.key
  const order = active ? normalizeSortOrder(current!.order) : null
  return {
    column,
    sorted: active && order !== null,
    order,
    toggle: () => toggleSort(column),
  }
}

function getColumnAriaSort(column: DataTableColumn): 'ascending' | 'descending' | 'none' | undefined {
  if (!column.sortable)
    return undefined
  const current = sortState.value
  if (current?.key !== column.key)
    return 'none'
  const order = normalizeSortOrder(current.order)
  if (!order)
    return 'none'
  return order === 'desc' ? 'descending' : 'ascending'
}

const {
  effectiveColumns,
  displayRows,
  filterOpenState,
  tagFilterQueries,
  activeFilter,
  setColumnFilter,
  clearColumnFilter,
  isColumnFiltered,
  isTagAllSelected,
  getColumnFilterOptions,
  getFilteredTagOptions,
  isTagOptionSelected,
  toggleTagFilter,
  getNumberFilterVal,
  setNumberFilterVal,
} = useDataTableData(props, sortState, emit)

// --- Loading ---------------------------------------------------------------
// Anything but an explicit `skeleton` keeps the overlay, so a mistyped variant
// still shows that the table is busy.
const isSkeletonLoading = computed(() => props.loading && props.loadingVariant === 'skeleton')
const showOverlay = computed(() => props.loading && props.loadingVariant !== 'skeleton')
// Placeholder rows only stand in for rows that do not exist yet. A refresh keeps
// the rows on screen and says so with the bar under the header instead.
const showSkeleton = computed(() => isSkeletonLoading.value && !displayRows.value.length)
const showRefreshBar = computed(() => isSkeletonLoading.value && displayRows.value.length > 0)

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

const fixedColumnOffsets = computed(() => {
  const left = new Map<string, string>()
  const right = new Map<string, string>()
  // The leading utility columns are not part of `columns`, so a fixed-left
  // column has to start after them or it sticks over the toggle / checkbox.
  let leftOffset = (props.expandable ? EXPAND_COLUMN_WIDTH : 0) + (props.selectable ? SELECT_COLUMN_WIDTH : 0)
  let rightOffset = 0

  for (const column of effectiveColumns.value) {
    if (getFixedSide(column) !== 'left')
      continue
    left.set(column.key, `${leftOffset}px`)
    leftOffset += getStickyWidth(column)
  }

  for (const column of [...effectiveColumns.value].reverse()) {
    if (getFixedSide(column) !== 'right')
      continue
    right.set(column.key, `${rightOffset}px`)
    rightOffset += getStickyWidth(column)
  }

  return { left, right }
})

const hasFixedColumns = computed(() => effectiveColumns.value.some(column => Boolean(getFixedSide(column))))

function columnStyle(column: DataTableColumn): Record<string, string> {
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
  if (fixedSide === 'left')
    style.left = fixedColumnOffsets.value.left.get(column.key) ?? '0px'
  else if (fixedSide === 'right')
    style.right = fixedColumnOffsets.value.right.get(column.key) ?? '0px'

  return style
}

function columnClass(column: DataTableColumn, type: 'header' | 'cell') {
  const fixedSide = getFixedSide(column)
  return [
    type === 'header' ? column.headerClass : column.cellClass,
    {
      'is-auto': column.auto,
      'is-fixed': Boolean(fixedSide),
      'is-fixed-left': fixedSide === 'left',
      'is-fixed-right': fixedSide === 'right',
      'is-nowrap': props.nowrap || column.nowrap,
      'is-sortable': type === 'header' && column.sortable,
      'is-sorted': type === 'header' && sortState.value?.key === column.key,
      'has-filter': type === 'header' && Boolean(column.filter),
      'is-filtered': isColumnFiltered(column.key),
      [`is-type-${column.type}`]: Boolean(column.type),
      'is-numeric': column.type === 'number',
    },
  ]
}

const colspan = computed(
  () => effectiveColumns.value.length + (props.selectable ? 1 : 0) + (props.expandable ? 1 : 0),
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
    class="tx-data-table"
    :class="{
      'is-striped': striped,
      'is-bordered': bordered,
      'is-hover': hover,
      'is-nowrap': nowrap,
      'has-fixed-columns': hasFixedColumns,
      'is-scroll-x': scrollX,
      'is-sticky-shell': isStickyShell,
      'has-sticky-header': stickyHeader,
      'has-sticky-footer': stickyFooter,
      'is-highlight-selected': highlightSelected,
      'is-expandable': expandable,
      [`is-layout-${tableLayout}`]: true,
    }"
    :style="shellStyle"
  >
    <div v-if="showOverlay" class="tx-data-table__loading" aria-live="polite">
      <TxSpinner :size="20" />
    </div>

    <table class="tx-data-table__table" :style="{ tableLayout }" :aria-busy="loading">
      <thead>
        <tr>
          <th v-if="expandable" class="tx-data-table__th tx-data-table__th--expand" scope="col" />
          <th v-if="selectable" class="tx-data-table__th tx-data-table__th--select" scope="col">
            <TxCheckbox
              :model-value="allSelected"
              :indeterminate="someSelected"
              aria-label="Select all"
              @update:model-value="toggleAll"
            />
          </th>
          <th
            v-for="column in effectiveColumns"
            :key="column.key"
            class="tx-data-table__th"
            scope="col"
            :class="columnClass(column, 'header')"
            :style="columnStyle(column)"
            :aria-sort="getColumnAriaSort(column)"
          >
            <div v-if="column.filter" class="tx-data-table__th-wrap" :class="`is-align-${column.align || 'left'}`">
              <button
                v-if="column.sortable"
                type="button"
                class="tx-data-table__sort-button"
                :class="`is-align-${column.align || 'left'}`"
                @click="toggleSort(column)"
              >
                <slot :name="`header-${column.key}`" v-bind="headerSlotProps(column)">
                  {{ column.title }}
                </slot>
                <span class="tx-data-table__sort" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="10" height="10" :class="{ 'is-active': sortState?.key === column.key && sortState?.order === 'asc' }">
                    <path fill="currentColor" d="M7 14l5-5 5 5z" />
                  </svg>
                  <svg viewBox="0 0 24 24" width="10" height="10" :class="{ 'is-active': sortState?.key === column.key && sortState?.order === 'desc' }">
                    <path fill="currentColor" d="M7 10l5 5 5-5z" />
                  </svg>
                </span>
              </button>
              <slot v-else :name="`header-${column.key}`" v-bind="headerSlotProps(column)">
                <span class="tx-data-table__th-title">{{ column.title }}</span>
              </slot>

              <TxPopover
                v-model="filterOpenState[column.key]"
                placement="bottom-start"
                :offset="6"
                panel-background="pure"
                :panel-radius="12"
                panel-shadow="soft"
                class="tx-data-table__filter-popover"
              >
                <template #reference>
                  <button
                    type="button"
                    class="tx-data-table__filter-trigger"
                    :class="{ 'is-active': isColumnFiltered(column.key) }"
                    :aria-label="`Filter ${column.title}`"
                    @click.stop
                  >
                    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                      <path fill="currentColor" d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z" />
                    </svg>
                  </button>
                </template>

                <div class="tx-data-table__filter-panel" @click.stop>
                  <slot
                    :name="`filter-${column.key}`"
                    :column="column"
                    :filter-value="activeFilter[column.key]"
                    :set-filter="(v: unknown) => setColumnFilter(column.key, v)"
                    :clear-filter="() => clearColumnFilter(column.key)"
                  >
                    <div v-if="column.type === 'tag'" class="tx-data-table__tag-filter">
                      <input
                        v-if="getColumnFilterOptions(column).length >= 8"
                        v-model="tagFilterQueries[column.key]"
                        class="tx-data-table__filter-search"
                        placeholder="搜索..."
                      />
                      <div class="tx-data-table__filter-options">
                        <button
                          type="button"
                          class="tx-data-table__filter-option"
                          :class="{ 'is-selected': isTagAllSelected(column.key) }"
                          @click="clearColumnFilter(column.key)"
                        >
                          <span>全部</span>
                        </button>
                        <button
                          v-for="opt in getFilteredTagOptions(column)"
                          :key="String(opt.value)"
                          type="button"
                          class="tx-data-table__filter-option"
                          :class="{ 'is-selected': isTagOptionSelected(column.key, opt.value) }"
                          @click="toggleTagFilter(column.key, opt.value)"
                        >
                          <span>{{ opt.label }}</span>
                          <span v-if="isTagOptionSelected(column.key, opt.value)" class="tx-data-table__filter-check">✓</span>
                        </button>
                      </div>
                    </div>

                    <div v-else-if="column.type === 'datetime' || column.type === 'date'" class="tx-data-table__date-filter">
                      <div class="tx-data-table__filter-options">
                        <button
                          type="button"
                          class="tx-data-table__filter-option"
                          :class="{ 'is-selected': !activeFilter[column.key] }"
                          @click="clearColumnFilter(column.key)"
                        >
                          全部时间
                        </button>
                        <button
                          v-for="opt in DATE_FILTER_PRESETS"
                          :key="opt.value"
                          type="button"
                          class="tx-data-table__filter-option"
                          :class="{ 'is-selected': activeFilter[column.key] === opt.value }"
                          @click="setColumnFilter(column.key, opt.value)"
                        >
                          {{ opt.label }}
                        </button>
                      </div>
                    </div>

                    <div v-else-if="column.type === 'number'" class="tx-data-table__number-filter">
                      <div class="tx-data-table__number-inputs">
                        <input
                          type="number"
                          class="tx-data-table__range-input"
                          placeholder="Min"
                          :value="getNumberFilterVal(column.key, 'min')"
                          @input="setNumberFilterVal(column.key, 'min', ($event.target as HTMLInputElement).value)"
                        />
                        <span class="tx-data-table__range-sep">~</span>
                        <input
                          type="number"
                          class="tx-data-table__range-input"
                          placeholder="Max"
                          :value="getNumberFilterVal(column.key, 'max')"
                          @input="setNumberFilterVal(column.key, 'max', ($event.target as HTMLInputElement).value)"
                        />
                      </div>
                      <div class="tx-data-table__filter-actions">
                        <button type="button" class="tx-data-table__btn-reset" @click="clearColumnFilter(column.key)">
重置
</button>
                        <button type="button" class="tx-data-table__btn-confirm" @click="filterOpenState[column.key] = false">
完成
</button>
                      </div>
                    </div>
                  </slot>
                </div>
              </TxPopover>
            </div>
            <template v-else>
              <button
                v-if="column.sortable"
                type="button"
                class="tx-data-table__sort-button"
                :class="`is-align-${column.align || 'left'}`"
                @click="toggleSort(column)"
              >
                <slot :name="`header-${column.key}`" v-bind="headerSlotProps(column)">
                  {{ column.title }}
                </slot>
                <span class="tx-data-table__sort" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="10" height="10" :class="{ 'is-active': sortState?.key === column.key && sortState?.order === 'asc' }">
                    <path fill="currentColor" d="M7 14l5-5 5 5z" />
                  </svg>
                  <svg viewBox="0 0 24 24" width="10" height="10" :class="{ 'is-active': sortState?.key === column.key && sortState?.order === 'desc' }">
                    <path fill="currentColor" d="M7 10l5 5 5-5z" />
                  </svg>
                </span>
              </button>
              <slot v-else :name="`header-${column.key}`" v-bind="headerSlotProps(column)">
                {{ column.title }}
              </slot>
            </template>
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
            v-for="row in skeletonRowCount"
            :key="`skeleton-${row}`"
            class="tx-data-table__row tx-data-table__row--skeleton"
            :class="{ 'is-stripe': expandable && striped && row % 2 === 1 }"
            aria-hidden="true"
          >
            <td v-if="expandable" class="tx-data-table__cell tx-data-table__cell--expand" />
            <td v-if="selectable" class="tx-data-table__cell tx-data-table__cell--select">
              <TxSkeleton class="tx-data-table__skeleton is-check" :width="18" :height="18" :radius="6" />
            </td>
            <td
              v-for="(column, columnIndex) in effectiveColumns"
              :key="column.key"
              class="tx-data-table__cell"
              :class="columnClass(column, 'cell')"
              :style="columnStyle(column)"
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
            <td v-if="expandable" class="tx-data-table__cell tx-data-table__cell--expand" @click.stop>
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
            <td v-if="selectable" class="tx-data-table__cell tx-data-table__cell--select" @click.stop>
              <TxCheckbox
                :model-value="selectedSet.has(getRowKey(row, index))"
                aria-label="Select row"
                @update:model-value="() => toggleRow(getRowKey(row, index))"
              />
            </td>
            <td
              v-for="column in effectiveColumns"
              :key="column.key"
              class="tx-data-table__cell"
              :class="columnClass(column, 'cell')"
              :style="columnStyle(column)"
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
            <td v-if="expandable" class="tx-data-table__footer-cell tx-data-table__footer-cell--expand" />
            <td v-if="selectable" class="tx-data-table__footer-cell tx-data-table__footer-cell--select" />
            <td
              v-for="column in effectiveColumns"
              :key="column.key"
              class="tx-data-table__footer-cell"
              :class="columnClass(column, 'cell')"
              :style="columnStyle(column)"
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
.tx-data-table {
  position: relative;
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
  &.has-fixed-columns:not(.is-scroll-x):not(.is-sticky-shell) {
    overflow: visible;
  }

  &.is-scroll-x {
    overflow-x: auto;
  }

  &.is-sticky-shell {
    overflow: auto;
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

:is(.tx-data-table__th, .tx-data-table__cell).is-fixed {
  position: sticky;
  z-index: 1;
  background: var(--tx-bg-color, #fff);
}

.tx-data-table__th.is-fixed {
  z-index: 3;
  background: var(--tx-fill-color-lighter, #fafafa);
}

:is(.tx-data-table__th, .tx-data-table__cell).is-fixed-left {
  box-shadow: 1px 0 0 var(--tx-border-color-lighter, #ebeef5);
}

:is(.tx-data-table__th, .tx-data-table__cell).is-fixed-right {
  box-shadow: -1px 0 0 var(--tx-border-color-lighter, #ebeef5);
}

.tx-data-table__th {
  font-weight: 600;
  color: var(--tx-text-color-regular, #606266);
  background: var(--tx-fill-color-lighter, #fafafa);
  user-select: none;
  white-space: nowrap;
}

.tx-data-table__th--select,
.tx-data-table__cell--select {
  width: 42px;
  text-align: center;
}

/* Expandable rows --------------------------------------------------------- */

/* Width is mirrored by EXPAND_COLUMN_WIDTH in the script: a fixed-left column
   offsets itself by this column. */
.tx-data-table__th--expand,
.tx-data-table__cell--expand {
  width: 40px;
  padding: 0;
  text-align: center;
}

.tx-data-table__expand-toggle,
.tx-data-table__filter-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.tx-data-table__expand-toggle {
  appearance: none;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  color: var(--tx-text-color-secondary, #909399);
  transition:
    transform 160ms ease,
    background-color 160ms ease,
    color 160ms ease;

  &:hover {
    color: var(--tx-text-color-primary, #303133);
    background: color-mix(in srgb, var(--tx-fill-color, #f0f2f5) 70%, transparent);
  }

  &.is-expanded {
    transform: rotate(90deg);
  }
}

.tx-data-table__expand-toggle:focus-visible {
  outline: 2px solid var(--tx-color-primary, #409eff);
  outline-offset: 1px;
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

.tx-data-table__th.is-sortable {
  padding: 0;
}

.tx-data-table__sort-button,
.tx-data-table__filter-option {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  width: 100%;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.tx-data-table__sort-button {
  appearance: none;
  justify-content: flex-start;
  padding: 10px 12px;
  color: inherit;
  font: inherit;
  text-align: inherit;
}

:is(.tx-data-table__sort-button, .tx-data-table__th-wrap).is-align-center {
  justify-content: center;
}

:is(.tx-data-table__sort-button, .tx-data-table__th-wrap).is-align-right {
  justify-content: flex-end;
}

.tx-data-table__sort-button:focus-visible,
.tx-data-table__row.is-interactive:focus-visible {
  outline: 2px solid var(--tx-color-primary, #409eff);
  outline-offset: -2px;
}

.tx-data-table__sort,
.tx-data-table__filter-trigger,
.tx-data-table__range-sep,
.tx-data-table__time-icon {
  color: var(--tx-text-color-placeholder, #a8abb2);
}

.tx-data-table__sort {
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
  margin-left: 6px;
}

.tx-data-table__sort svg {
  opacity: 0.45;
}

.tx-data-table__sort svg.is-active {
  opacity: 1;
  color: var(--tx-color-primary, #409eff);
}

// Detail rows live in the same tbody, so `nth-child(odd)` stops matching the
// data rows. An expandable table stripes off the row's own `is-stripe` class.
.tx-data-table.is-striped:not(.is-expandable) .tx-data-table__table > tbody > tr:nth-child(odd),
.tx-data-table.is-striped.is-expandable .tx-data-table__row.is-stripe {
  background: color-mix(in srgb, var(--tx-fill-color-light, #f5f7fa) 60%, transparent);
}

// The fallback is the long-standing accent tint. The variable exists so a host
// with a different table language (a neutral-grey BUI records table, say) can
// repoint the hover without a prop or an override on `!important`.
.tx-data-table.is-hover .tx-data-table__table > tbody > tr:hover:not(.tx-data-table__row--detail) {
  background: var(
    --tx-data-table-row-hover-bg,
    color-mix(in srgb, var(--tx-color-primary-light-9, #ecf5ff) 60%, transparent)
  );
}

// Selection paints on the cells, not the row: a fixed column carries its own
// opaque background to cover the scrolled content, which would otherwise sit on
// top of any <tr> tint and leave the selected row looking half-highlighted.
.tx-data-table.is-highlight-selected .tx-data-table__row.is-selected > .tx-data-table__cell {
  background: var(
    --tx-data-table-row-selected-bg,
    color-mix(in srgb, var(--tx-color-primary, #409eff) 7%, var(--tx-bg-color, #fff))
  );
}

.tx-data-table__row.is-interactive {
  cursor: pointer;
}

.tx-data-table__loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--tx-bg-color, #fff) 70%, transparent);
  z-index: 2;
  backdrop-filter: blur(4px);
}

/* Skeleton loading -------------------------------------------------------- */

/* The bar sits in a box one line tall, inside the same cell padding as a loaded
   cell, so a placeholder row is exactly as tall as a one-line row of text. */
.tx-data-table__skeleton {
  height: 1lh;
  justify-content: center;
}

/* The selection column: a box of the checkbox's size, on the text baseline as the
   checkbox is, so a selectable placeholder row matches a selectable row too. */
.tx-data-table__skeleton.is-check {
  display: inline-flex;
  height: auto;
}

/* A placeholder takes no hover tint and no clicks. */
.tx-data-table__row--skeleton {
  pointer-events: none;
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

.tx-data-table__empty {
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

.tx-data-table__footer-cell--select {
  width: 42px;
  text-align: center;
}

.tx-data-table__footer-cell--expand {
  width: 40px;
  text-align: center;
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

/* Filter & type styling -------------------------------------------------- */

.tx-data-table__th-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
}

.tx-data-table__th.has-filter {
  padding-right: 6px;
}

.tx-data-table__filter-trigger {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  transition: color 140ms ease, background-color 140ms ease;

  &:hover {
    color: var(--tx-text-color-primary, #303133);
    background: color-mix(in srgb, var(--tx-fill-color, #f0f2f5) 80%, transparent);
  }

  &.is-active {
    color: var(--tx-color-primary, #409eff);
    background: color-mix(in srgb, var(--tx-color-primary, #409eff) 12%, transparent);
  }
}

.tx-data-table__filter-panel {
  padding: 8px;
  min-width: 130px;
  max-width: 240px;
  font-size: 13px;
  color: var(--tx-text-color-primary, #303133);
}

.tx-data-table__filter-search,
.tx-data-table__range-input {
  box-sizing: border-box;
  border: 1px solid var(--tx-border-color-lighter, #ebeef5);
  border-radius: 6px;
  font-size: 12px;
  outline: none;

  &:focus {
    border-color: var(--tx-color-primary, #409eff);
  }
}

.tx-data-table__filter-search {
  width: 100%;
  padding: 5px 8px;
  background: var(--tx-bg-color, #fff);
  color: inherit;
  margin-bottom: 6px;
}

.tx-data-table__filter-options {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 200px;
  overflow-y: auto;
}

.tx-data-table__filter-option {
  justify-content: space-between;
  padding: 6px 8px;
  border-radius: 6px;
  color: var(--tx-text-color-regular, #606266);
  font-size: 12px;
  text-align: left;
  transition: background-color 120ms ease, color 120ms ease;

  &:hover {
    background: var(--tx-fill-color-light, #f5f7fa);
    color: var(--tx-text-color-primary, #303133);
  }

  &.is-selected {
    color: var(--tx-color-primary, #409eff);
    font-weight: 500;
    background: color-mix(in srgb, var(--tx-color-primary, #409eff) 10%, transparent);
  }
}

.tx-data-table__filter-check {
  font-size: 11px;
}

.tx-data-table__number-inputs {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.tx-data-table__range-input {
  width: 72px;
  padding: 4px 6px;
}

.tx-data-table__range-sep {
  font-size: 12px;
}

.tx-data-table__filter-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.tx-data-table__btn-reset,
.tx-data-table__btn-confirm {
  padding: 3px 8px;
  border: 0;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}

.tx-data-table__btn-reset {
  background: transparent;
  color: var(--tx-text-color-secondary, #909399);

  &:hover {
    color: var(--tx-text-color-primary, #303133);
  }
}

.tx-data-table__btn-confirm {
  background: var(--tx-color-primary, #409eff);
  color: #fff;
}

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
  font-weight: 500;
  background: var(--tx-fill-color, #f0f2f5);
}

.tx-data-table__source-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  background: var(--tx-fill-color-lighter, #fafafa);
  border: 1px solid var(--tx-border-color-lighter, #ebeef5);
  color: var(--tx-text-color-secondary, #909399);
}

.tx-data-table__datetime {
  gap: 4px;
  font-variant-numeric: tabular-nums;
}

.tx-data-table__time-icon {
  flex-shrink: 0;
}

.tx-data-table__number,
.tx-data-table__cell.is-numeric {
  font-variant-numeric: tabular-nums;
}
</style>
