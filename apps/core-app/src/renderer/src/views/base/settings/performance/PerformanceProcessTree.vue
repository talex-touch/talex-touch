<script setup lang="ts">
import type {
  PerformanceProcessTreeEntry,
  PerformanceProcessTreeReport
} from '@talex-touch/utils/transport/events/types'
import type { DataTableColumn } from '@talex-touch/tuffex/data-table'
import { TxButton } from '@talex-touch/tuffex/button'
import { TxDataTable } from '@talex-touch/tuffex/data-table'
import { TxTag } from '@talex-touch/tuffex/tag'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatMemory, formatPercent } from './format'

const props = defineProps<{
  tree: PerformanceProcessTreeReport | null
  loading: boolean
  error: boolean
}>()
const emit = defineEmits<{ sample: [] }>()
const { t, locale } = useI18n()
const columns = computed<DataTableColumn<PerformanceProcessTreeEntry>[]>(() => [
  { key: 'pid', title: t('settingPerformance.pid'), width: 80 },
  { key: 'command', title: t('settingPerformance.command'), minWidth: 220 },
  { key: 'threads', title: t('settingPerformance.threadCount'), width: 95 },
  { key: 'cpuPercent', title: t('settingPerformance.metrics.cpu'), width: 90 },
  { key: 'residentBytes', title: t('settingPerformance.rss'), width: 110 }
])
const totalThreads = computed(
  () => props.tree?.processes.reduce((sum, entry) => sum + (entry.threads ?? 0), 0) ?? 0
)
const unknownCounts = computed(
  () => props.tree?.processes.filter((entry) => entry.threads === null).length ?? 0
)
const sampledAt = computed(() =>
  props.tree ? new Date(props.tree.capturedAt).toLocaleString(locale.value) : ''
)
</script>

<template>
  <section class="flex flex-col gap-3" :aria-label="t('settingPerformance.deepSampling')">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-base font-semibold">{{ t('settingPerformance.deepSampling') }}</h2>
        <p>{{ t('settingPerformance.treeNote') }}</p>
      </div>
      <TxButton :disabled="loading" @click="emit('sample')">
        {{ t(loading ? 'settingPerformance.samplingTree' : 'settingPerformance.sampleTree') }}
      </TxButton>
    </div>
    <p v-if="error" role="alert" :style="{ color: 'var(--tx-color-danger)' }">
      {{ t('settingPerformance.treeError') }}
    </p>
    <template v-if="tree">
      <p>
        {{
          t('settingPerformance.treeCapturedAt', {
            time: sampledAt,
            collectMs: tree.collectMs.toFixed(1)
          })
        }}
      </p>
      <template v-if="tree.supported">
        <p>{{ t('settingPerformance.totalThreads', { count: totalThreads }) }}</p>
        <p v-if="unknownCounts">
          {{ t('settingPerformance.unknownThreadCounts', { count: unknownCounts }) }}
        </p>
        <TxDataTable
          :columns="columns"
          :data="tree.processes"
          row-key="pid"
          :scroll-x="true"
          :empty-text="t('settingPerformance.processEmpty')"
        >
          <template #cell-command="{ row }">
            <div class="flex flex-wrap items-center gap-2">
              <span>{{ row.command }}</span>
              <TxTag v-if="row.electronManaged">{{
                t('settingPerformance.electronManaged')
              }}</TxTag>
            </div>
          </template>
          <template #cell-threads="{ row }">{{ row.threads ?? '—' }}</template>
          <template #cell-cpuPercent="{ row }">{{ formatPercent(row.cpuPercent) }}</template>
          <template #cell-residentBytes="{ row }">{{ formatMemory(row.residentBytes) }}</template>
        </TxDataTable>
      </template>
      <p v-else>{{ t('settingPerformance.treeUnsupported') }}</p>
    </template>
    <p v-else>{{ t('settingPerformance.treeEmpty') }}</p>
  </section>
</template>
