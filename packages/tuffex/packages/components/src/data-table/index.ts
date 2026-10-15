import type {
  DataTableAlign,
  DataTableColumnFixed,
  DataTableColumn,
  DataTableColumnType,
  DataTableFilterOption,
  DataTableFilterSlotProps,
  DataTableFilterState,
  DataTableEmits,
  DataTableHeaderSlotProps,
  DataTableKey,
  DataTableLabels,
  DataTableLayout,
  DataTableLoadingVariant,
  DataTableProps,
  DataTableRowClass,
  DataTableRowKey,
  DataTableSortCycle,
  DataTableSortOrder,
  DataTableSortState,
} from './src/types'
import { withInstall } from '../../../utils/withInstall'
import TxDataTable from './src/TxDataTable.vue'

const DataTable = withInstall(TxDataTable)

export { DATA_TABLE_DEFAULT_LABELS } from './src/types'
export { DataTable, TxDataTable }
export type {
  DataTableAlign,
  DataTableColumnFixed,
  DataTableColumn,
  DataTableColumnType,
  DataTableFilterOption,
  DataTableFilterSlotProps,
  DataTableFilterState,
  DataTableEmits,
  DataTableHeaderSlotProps,
  DataTableKey,
  DataTableLabels,
  DataTableLayout,
  DataTableLoadingVariant,
  DataTableProps,
  DataTableRowClass,
  DataTableRowKey,
  DataTableSortCycle,
  DataTableSortOrder,
  DataTableSortState,
}
export type TxDataTableInstance = InstanceType<typeof TxDataTable>

export default DataTable
