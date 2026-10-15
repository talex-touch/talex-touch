import type { Ref } from 'vue'
import type { DataTableColumn, DataTableEmits, DataTableFilterOption, DataTableFilterState, DataTableLabels, DataTableProps, DataTableSortState } from './types'
import { computed, ref, watch } from 'vue'

export function getCellValue<T>(row: T, column: DataTableColumn<T>): unknown {
  const key = column.dataIndex ?? column.key
  return (row as Record<string, unknown> | null | undefined)?.[key]
}

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function getDateTimestamp(value: unknown, dateOnly: boolean): number {
  const text = String(value ?? '')
  // A date-only column is a local calendar day, not ISO's UTC midnight.
  const input = dateOnly && CALENDAR_DATE_PATTERN.test(text) ? `${text}T00:00:00` : text
  return new Date(input).getTime()
}

function defaultSorter(a: unknown, b: unknown): number {
  if (a == null && b == null)
    return 0
  if (a == null)
    return -1
  if (b == null)
    return 1
  if (typeof a === 'number' && typeof b === 'number')
    return a - b
  const sa = String(a)
  const sb = String(b)
  return sa.localeCompare(sb)
}

// The filter values are the public contract (`filter: { time: '7d' }`); the
// visible text comes from `labels`, so a host localizes without remapping values.
export const DATE_FILTER_PRESETS: ReadonlyArray<{ value: string, label: keyof DataTableLabels }> = [
  { value: 'today', label: 'filterToday' },
  { value: '3d', label: 'filterLast3Days' },
  { value: '7d', label: 'filterLast7Days' },
  { value: '30d', label: 'filterLast30Days' },
]

function optionLabelOf(value: unknown): string {
  return typeof value === 'object' && value && 'label' in value ? String((value as { label: unknown }).label) : String(value)
}

// Owns semantic-column defaults and filtering, while the table retains selection,
// expansion, layout and sorting interaction. Props and sort remain live reactive inputs.
export function useDataTableData<T>(
  props: DataTableProps<T>,
  sortState: Readonly<Ref<DataTableSortState | null>>,
  emit: DataTableEmits<T>,
) {
  const effectiveColumns = computed<DataTableColumn<T>[]>(() => {
    return props.columns.map(col => {
      const next: DataTableColumn<T> = { ...col }
      const key = col.key?.toLowerCase() || ''
      const title = typeof col.title === 'string' ? col.title : ''
      const isAction = col.type === 'actions' || key === 'actions' || key === 'action' || title.includes('操作')

      if (isAction) {
        if (props.autoStickyActions !== false && col.fixed === undefined) {
          next.fixed = 'right'
        }
        if (col.align === undefined) {
          next.align = 'right'
        }
        // No default width: a nowrap column without one hugs its buttons, so
        // the column is as wide as what the host puts in it.
        if (col.nowrap === undefined) {
          next.nowrap = true
        }
        next.type = next.type || 'actions'
        return next
      }

      if (col.type === 'number') {
        if (col.align === undefined) {
          next.align = 'right'
        }
        if (col.nowrap === undefined) {
          next.nowrap = true
        }
        if (col.sortable === undefined) {
          next.sortable = true
        }
        if (!col.sorter) {
          next.sorter = (a: T, b: T) => {
            const va = Number(getCellValue(a, col))
            const vb = Number(getCellValue(b, col))
            if (Number.isNaN(va) && Number.isNaN(vb)) return 0
            if (Number.isNaN(va)) return -1
            if (Number.isNaN(vb)) return 1
            return va - vb
          }
        }
      } else if (col.type === 'datetime' || col.type === 'date') {
        if (col.nowrap === undefined) {
          next.nowrap = true
        }
        if (col.sortable === undefined) {
          next.sortable = true
        }
        if (!col.sorter) {
          next.sorter = (a: T, b: T) => {
            const da = getDateTimestamp(getCellValue(a, col), col.type === 'date')
            const db = getDateTimestamp(getCellValue(b, col), col.type === 'date')
            if (Number.isNaN(da) && Number.isNaN(db)) return 0
            if (Number.isNaN(da)) return -1
            if (Number.isNaN(db)) return 1
            return da - db
          }
        }
      } else if (col.type === 'tag') {
        if (col.nowrap === undefined) {
          next.nowrap = true
        }
      } else if (col.type === 'source') {
        if (col.nowrap === undefined) {
          next.nowrap = true
        }
      }

      return next
    })
  })

  const filterOpenState = ref<Record<string, boolean>>({})
  const tagFilterQueries = ref<Record<string, string>>({})
  const localFilter = ref<DataTableFilterState>({ ...(props.defaultFilter ?? {}) })

  watch(
    () => props.defaultFilter,
    next => {
      localFilter.value = { ...(next ?? {}) }
    },
    { deep: true },
  )

  const activeFilter = computed<DataTableFilterState>(() => {
    return props.filter !== undefined ? props.filter : localFilter.value
  })

  function setColumnFilter(key: string, value: unknown) {
    const next: DataTableFilterState = { ...activeFilter.value }
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
      delete next[key]
    } else {
      next[key] = value
    }
    localFilter.value = next
    emit('update:filter', next)
    emit('filterChange', next)
  }

  function clearColumnFilter(key: string) {
    setColumnFilter(key, undefined)
  }

  function isColumnFiltered(key: string): boolean {
    const val = activeFilter.value[key]
    if (val === undefined || val === null || val === '') return false
    if (Array.isArray(val)) return val.length > 0
    if (typeof val === 'object') {
      return Object.values(val as Record<string, unknown>).some(v => v !== undefined && v !== null && v !== '')
    }
    return true
  }

  function isTagAllSelected(colKey: string): boolean {
    const val = activeFilter.value[colKey]
    if (!val) return true
    if (Array.isArray(val)) return val.length === 0
    return false
  }

  function getColumnFilterOptions(col: DataTableColumn): DataTableFilterOption[] {
    if (col.filterOptions && col.filterOptions.length > 0)
      return col.filterOptions
    const counts = new Map<string, number>()
    for (const row of props.data) {
      const v = getCellValue(row, col)
      if (v != null && v !== '') {
        const label = optionLabelOf(v)
        if (label) counts.set(label, (counts.get(label) ?? 0) + 1)
      }
    }
    // Gathered from the rows, so the rows can count them — but only while the
    // rows are the whole set; with server-side filtering `data` is one page.
    return Array.from(counts, ([val, count]) => (props.filterOnClient ? { label: val, value: val, count } : { label: val, value: val }))
  }

  // "All" counts the rows only when the options were counted from those rows.
  function getAllOptionCount(col: DataTableColumn): number | undefined {
    return props.filterOnClient && !col.filterOptions?.length ? props.data.length : undefined
  }

  function getFilteredTagOptions(col: DataTableColumn): DataTableFilterOption[] {
    const all = getColumnFilterOptions(col)
    const query = (tagFilterQueries.value[col.key] || '').trim().toLowerCase()
    if (!query) return all
    return all.filter(opt => opt.label.toLowerCase().includes(query))
  }

  function isTagOptionSelected(colKey: string, val: unknown): boolean {
    const current = activeFilter.value[colKey]
    if (!current) return false
    if (Array.isArray(current)) return current.includes(val) || current.includes(String(val))
    return current === val || String(current) === String(val)
  }

  function toggleTagFilter(colKey: string, val: unknown) {
    const current = activeFilter.value[colKey]
    let next: unknown[]
    if (Array.isArray(current)) {
      next = [...current]
      const idx = next.findIndex(item => item === val || String(item) === String(val))
      if (idx >= 0) {
        next.splice(idx, 1)
      } else {
        next.push(val)
      }
    } else if (current !== undefined && current !== null && current !== '') {
      if (current === val || String(current) === String(val)) {
        next = []
      } else {
        next = [current, val]
      }
    } else {
      next = [val]
    }
    setColumnFilter(colKey, next.length ? next : undefined)
  }

  function getNumberFilterVal(colKey: string, bound: 'min' | 'max'): number | null {
    const current = activeFilter.value[colKey]
    const val = typeof current === 'object' && current !== null
      ? (current as Record<string, unknown>)[bound]
      : bound === 'min' ? current : undefined
    const num = val == null || val === '' ? Number.NaN : Number(val)
    return Number.isNaN(num) ? null : num
  }

  function setNumberFilterVal(colKey: string, bound: 'min' | 'max', rawVal: string | number | null) {
    const current = typeof activeFilter.value[colKey] === 'object' && activeFilter.value[colKey] !== null
      ? { ...(activeFilter.value[colKey] as Record<string, unknown>) }
      : {}
    const num = rawVal == null || String(rawVal).trim() === '' ? undefined : Number(rawVal)
    if (num === undefined || Number.isNaN(num)) {
      delete current[bound]
    } else {
      current[bound] = num
    }
    if (current.min === undefined && current.max === undefined) {
      setColumnFilter(colKey, undefined)
    } else {
      setColumnFilter(colKey, current)
    }
  }

  const displayRows = computed(() => {
    let rows = props.data.slice()

    if (props.filterOnClient) {
      const filters = activeFilter.value
      const filterKeys = Object.keys(filters)
      if (filterKeys.length > 0) {
        let startOfToday: number | undefined
        let endOfToday: number | undefined
        rows = rows.filter(row => {
          return filterKeys.every(k => {
            const targetCol = effectiveColumns.value.find(c => c.key === k)
            if (!targetCol) return true
            const filterVal = filters[k]
            if (filterVal === undefined || filterVal === null || filterVal === '') return true
            const cellVal = getCellValue(row, targetCol)

            if (targetCol.type === 'tag') {
              const rawVal = cellVal && typeof cellVal === 'object' && 'label' in cellVal ? (cellVal as { label: unknown }).label : cellVal
              if (Array.isArray(filterVal)) {
                if (!filterVal.length) return true
                return filterVal.includes(rawVal) || filterVal.includes(String(rawVal))
              }
              return String(rawVal) === String(filterVal)
            }

            if (targetCol.type === 'number') {
              const num = Number(cellVal)
              if (typeof filterVal === 'object' && filterVal !== null) {
                const { min, max } = filterVal as { min?: number, max?: number }
                if (min != null && !Number.isNaN(Number(min)) && num < Number(min)) return false
                if (max != null && !Number.isNaN(Number(max)) && num > Number(max)) return false
                return true
              }
              return num === Number(filterVal)
            }

            if (targetCol.type === 'datetime' || targetCol.type === 'date') {
              const t = getDateTimestamp(cellVal, targetCol.type === 'date')
              if (Number.isNaN(t)) return false
              const now = Date.now()
              if (filterVal === 'today') {
                if (startOfToday === undefined) {
                  const day = new Date(now)
                  startOfToday = day.setHours(0, 0, 0, 0)
                  endOfToday = day.setDate(day.getDate() + 1)
                }
                return t >= startOfToday && t < endOfToday!
              }
              if (filterVal === '3d') {
                return t >= now - 3 * 86400000
              }
              if (filterVal === '7d') {
                return t >= now - 7 * 86400000
              }
              if (filterVal === '30d') {
                return t >= now - 30 * 86400000
              }
              if (typeof filterVal === 'object' && filterVal !== null) {
                const { start, end } = filterVal as { start?: number, end?: number }
                if (start != null && t < start) return false
                if (end != null && t > end) return false
                return true
              }
              return true
            }

            return String(cellVal ?? '').toLowerCase().includes(String(filterVal).toLowerCase())
          })
        })
      }
    }

    if (!props.sortOnClient)
      return rows
    const state = sortState.value
    if (!state)
      return rows
    const col = effectiveColumns.value.find(c => c.key === state.key)
    if (!col)
      return rows
    const dir = state.order === 'desc' ? -1 : 1
    const sorter = col.sorter ?? ((a: T, b: T) => defaultSorter(getCellValue(a, col), getCellValue(b, col)))
    return rows.sort((a, b) => dir * sorter(a, b))
  })

  return {
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
    getAllOptionCount,
    getFilteredTagOptions,
    isTagOptionSelected,
    toggleTagFilter,
    getNumberFilterVal,
    setNumberFilterVal,
  }
}
