import type { ComputedRef, InjectionKey } from 'vue'
import type { DataTableLabels } from './types'
import type { useDataTableData } from './use-data-table-data'

/**
 * What a column's filter control needs from the table that owns it.
 *
 * The table keeps the filter state, because it filters its rows by it; each
 * header's control reads and writes that state here instead of taking it as a
 * dozen forwarded props.
 *
 * Internal: not exported from the package barrel.
 */
export type DataTableFilterContext = Pick<
  ReturnType<typeof useDataTableData>,
  | 'filterOpenState'
  | 'tagFilterQueries'
  | 'activeFilter'
  | 'setColumnFilter'
  | 'clearColumnFilter'
  | 'isColumnFiltered'
  | 'isTagAllSelected'
  | 'getColumnFilterOptions'
  | 'getAllOptionCount'
  | 'getFilteredTagOptions'
  | 'isTagOptionSelected'
  | 'toggleTagFilter'
  | 'getNumberFilterVal'
  | 'setNumberFilterVal'
> & {
  labels: ComputedRef<DataTableLabels>
}

export const DATA_TABLE_FILTER_CONTEXT: InjectionKey<DataTableFilterContext> = Symbol('tx-data-table-filter')
