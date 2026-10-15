<script setup lang="ts">
import type { FunctionalComponent } from 'vue'
import type { DataTableColumn } from './types'
import { computed, h, inject, nextTick } from 'vue'
import { TxButton } from '../../button'
import { TxDropdownItem, TxDropdownMenu } from '../../dropdown-menu'
import { TxInput } from '../../input'
import { TxNumberInput } from '../../number-input'
import { TxPopover } from '../../popover'
import { DATA_TABLE_FILTER_CONTEXT } from './context'
import { DATE_FILTER_PRESETS } from './use-data-table-data'

/**
 * A column header's filter: its trigger and the panel that trigger opens.
 * Option lists open as a TuffEx menu, ranges and text as a popover form, so the
 * panels wear the library's own surface, rows and fields. A `filter-<key>`
 * slot, forwarded here as the default slot, replaces the panel outright.
 */
defineOptions({ name: 'TxDataTableColumnFilter' })

const props = defineProps<{ column: DataTableColumn }>()

// A long tag list gets a search field once scanning it stops being quick.
const OPTION_SEARCH_THRESHOLD = 8

// How many frames a filter field keeps trying to take the focus while its
// panel opens; the anchor itself waits up to ten frames for a stable size.
const FILTER_FOCUS_FRAMES = 60

const FILTER_ICON_PATH = 'M2.75 3.25h10.5L9.25 8.1v3.9l-2.5 1.25V8.1z'

const {
  labels,
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
} = inject(DATA_TABLE_FILTER_CONTEXT)!

const placement = computed(() => (props.column.align === 'right' ? 'bottom-end' : 'bottom-start'))
const open = computed(() => Boolean(filterOpenState.value[props.column.key]))
const hasSearch = computed(() => getColumnFilterOptions(props.column).length >= OPTION_SEARCH_THRESHOLD)
const allCount = computed(() => getAllOptionCount(props.column))

function setFilter(value: unknown) {
  setColumnFilter(props.column.key, value)
}

function clearFilter() {
  clearColumnFilter(props.column.key)
}

function close() {
  filterOpenState.value[props.column.key] = false
}

// The field a filter panel opens on takes the focus, so typing starts at once.
interface FilterField {
  $el?: unknown
}

let field: FilterField | null = null

function setField(value: unknown) {
  field = value as FilterField | null
}

// The anchor shows its panel a few frames after `open`, once the panel is
// placed and sized; until then the field is hidden and refuses the focus, so
// the call repeats each frame. It counts frames rather than time, since a busy
// or background window stretches them, and it only ever takes the focus from
// where the opening click or key left it: once the user has moved the focus,
// or the panel has closed, it stops. The focus can land while the panel is
// still growing from zero height, where a plain focus would scroll the field
// to the middle of that empty box and leave the list scrolled past its search
// field once the panel has grown.
function focusField() {
  const origin = document.activeElement
  let frames = 0
  const attempt = () => {
    if (!open.value || document.activeElement !== origin)
      return
    const el = field?.$el instanceof Element ? field.$el : null
    el?.querySelector<HTMLElement>('input, textarea')?.focus({ preventScroll: true })
    if (document.activeElement === origin && ++frames < FILTER_FOCUS_FRAMES && typeof requestAnimationFrame === 'function')
      requestAnimationFrame(attempt)
  }
  nextTick(attempt)
}

// One trigger for every panel kind; `is-active` fills the funnel while the
// column filters the rows.
const FilterTrigger: FunctionalComponent = () => h(
  'button',
  {
    'type': 'button',
    'class': ['tx-data-table__filter-trigger', {
      'is-active': isColumnFiltered(props.column.key),
      'is-open': open.value,
    }],
    'aria-label': labels.value.filter.replace('{column}', props.column.title),
  },
  h(
    'svg',
    { 'viewBox': '0 0 16 16', 'width': 14, 'height': 14, 'fill': 'none', 'stroke': 'currentColor', 'stroke-width': 1.4, 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    h('path', { d: FILTER_ICON_PATH }),
  ),
)
</script>

<template>
  <TxPopover
    v-if="$slots.default"
    v-model="filterOpenState[column.key]"
    :placement="placement"
    :offset="6"
    :match-reference-width="false"
  >
    <template #reference>
      <FilterTrigger />
    </template>
    <slot
      :column="column"
      :filter-value="activeFilter[column.key]"
      :set-filter="setFilter"
      :clear-filter="clearFilter"
      :close="close"
    />
  </TxPopover>

  <TxDropdownMenu
    v-else-if="column.type === 'tag'"
    v-model="filterOpenState[column.key]"
    :placement="placement"
    :close-on-select="false"
    :initial-focus="hasSearch ? 'none' : 'first-item'"
    :min-width="200"
    :max-height="360"
    @open="hasSearch && focusField()"
  >
    <template #trigger>
      <FilterTrigger />
    </template>
    <TxInput
      v-if="hasSearch"
      :ref="setField"
      v-model="tagFilterQueries[column.key]"
      class="tx-data-table__filter-search"
      :placeholder="labels.filterSearch"
      :aria-label="labels.filterSearch"
      clearable
    />
    <TxDropdownItem :checked="isTagAllSelected(column.key)" @select="clearFilter">
      {{ labels.filterAll }}
      <template v-if="allCount !== undefined" #right>
        <span class="tx-data-table__filter-count">{{ allCount }}</span>
      </template>
    </TxDropdownItem>
    <TxDropdownItem
      v-for="option in getFilteredTagOptions(column)"
      :key="String(option.value)"
      :checked="isTagOptionSelected(column.key, option.value)"
      @select="toggleTagFilter(column.key, option.value)"
    >
      {{ option.label }}
      <template v-if="option.count !== undefined" #right>
        <span class="tx-data-table__filter-count">{{ option.count }}</span>
      </template>
    </TxDropdownItem>
  </TxDropdownMenu>

  <TxDropdownMenu
    v-else-if="column.type === 'datetime' || column.type === 'date'"
    v-model="filterOpenState[column.key]"
    :placement="placement"
    :min-width="180"
  >
    <template #trigger>
      <FilterTrigger />
    </template>
    <TxDropdownItem check-type="radio" :checked="!isColumnFiltered(column.key)" @select="clearFilter">
      {{ labels.filterAnyTime }}
    </TxDropdownItem>
    <TxDropdownItem
      v-for="preset in DATE_FILTER_PRESETS"
      :key="preset.value"
      check-type="radio"
      :checked="activeFilter[column.key] === preset.value"
      @select="setFilter(preset.value)"
    >
      {{ labels[preset.label] }}
    </TxDropdownItem>
  </TxDropdownMenu>

  <TxPopover
    v-else
    v-model="filterOpenState[column.key]"
    :placement="placement"
    :offset="6"
    :match-reference-width="false"
    @open="focusField"
  >
    <template #reference>
      <FilterTrigger />
    </template>
    <div class="tx-data-table__filter-form">
      <div v-if="column.type === 'number'" class="tx-data-table__filter-range">
        <TxNumberInput
          :ref="setField"
          :model-value="getNumberFilterVal(column.key, 'min')"
          :controls="false"
          :placeholder="labels.filterMin"
          :aria-label="labels.filterMin"
          @update:model-value="(value: number | null) => setNumberFilterVal(column.key, 'min', value)"
        />
        <span aria-hidden="true">–</span>
        <TxNumberInput
          :model-value="getNumberFilterVal(column.key, 'max')"
          :controls="false"
          :placeholder="labels.filterMax"
          :aria-label="labels.filterMax"
          @update:model-value="(value: number | null) => setNumberFilterVal(column.key, 'max', value)"
        />
      </div>
      <TxInput
        v-else
        :ref="setField"
        :model-value="String(activeFilter[column.key] ?? '')"
        :placeholder="labels.filterSearch"
        :aria-label="labels.filterSearch"
        clearable
        @update:model-value="setFilter"
      />
      <div v-if="column.type === 'number'" class="tx-data-table__filter-actions">
        <TxButton variant="ghost" size="sm" @click="clearFilter">
          {{ labels.filterReset }}
        </TxButton>
        <TxButton variant="primary" size="sm" @click="close">
          {{ labels.filterApply }}
        </TxButton>
      </div>
    </div>
  </TxPopover>
</template>
