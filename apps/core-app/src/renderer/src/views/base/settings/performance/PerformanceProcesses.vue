<script setup lang="ts">
import type { PerformanceProcessSample } from '@talex-touch/utils/transport/events/types'
import type { DataTableColumn } from '@talex-touch/tuffex/data-table'
import { TxDataTable } from '@talex-touch/tuffex/data-table'
import { TuffProgress } from '@talex-touch/tuffex/progress'
import { TxTag } from '@talex-touch/tuffex/tag'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatMemory, formatPercent, formatRate } from './format'

const props = defineProps<{ processes: PerformanceProcessSample[] }>()
const { t } = useI18n()
const rows = computed(() => [...props.processes].sort((a, b) => b.cpuPercent - a.cpuPercent))
/** Bars show each process's share of what Tuff as a whole is using, not of the machine. */
const totalCpu = computed(() => props.processes.reduce((sum, sample) => sum + sample.cpuPercent, 0))
function cpuShare(cpuPercent: number): number {
  return totalCpu.value > 0 ? Math.min(100, (cpuPercent / totalCpu.value) * 100) : 0
}
const columns = computed<DataTableColumn<PerformanceProcessSample>[]>(() => [
  { key: 'role', title: t('settingPerformance.processRole'), minWidth: 260 },
  { key: 'pid', title: t('settingPerformance.pid'), width: 80 },
  { key: 'cpuPercent', title: t('settingPerformance.metrics.cpu'), minWidth: 125 },
  { key: 'workingSetBytes', title: t('settingPerformance.metrics.memory'), width: 115 },
  { key: 'idleWakeupsPerSecond', title: t('settingPerformance.metrics.wakeups'), width: 130 }
])
</script>

<template>
  <section class="flex flex-col gap-3" :aria-label="t('settingPerformance.processes')">
    <div>
      <h2 class="text-base font-semibold">{{ t('settingPerformance.processes') }}</h2>
      <p>{{ t('settingPerformance.processNote') }}</p>
    </div>
    <TxDataTable
      :columns="columns"
      :data="rows"
      row-key="pid"
      :scroll-x="true"
      :empty-text="t('settingPerformance.processEmpty')"
    >
      <template #cell-role="{ row }">
        <div class="flex flex-col gap-1">
          <span class="font-medium">{{
            t(`settingPerformance.processRoles.${row.role}.name`)
          }}</span>
          <p class="whitespace-normal">
            {{ t(`settingPerformance.processRoles.${row.role}.description`) }}
          </p>
          <div v-if="row.surfaces.length" class="flex flex-wrap gap-1">
            <TxTag v-for="(surface, index) in row.surfaces" :key="index">
              {{
                t(`settingPerformance.surfaces.${surface.kind}`, {
                  pluginName: surface.pluginName ?? t('settingPerformance.unknownPlugin')
                })
              }}
            </TxTag>
          </div>
        </div>
      </template>
      <template #cell-cpuPercent="{ row }">
        <span class="tabular-nums">{{ formatPercent(row.cpuPercent) }}</span>
        <TuffProgress :percentage="cpuShare(row.cpuPercent)" :show-text="false" :stroke-width="4" />
      </template>
      <template #cell-workingSetBytes="{ row }">{{ formatMemory(row.workingSetBytes) }}</template>
      <template #cell-idleWakeupsPerSecond="{ row }">{{
        formatRate(row.idleWakeupsPerSecond)
      }}</template>
    </TxDataTable>
  </section>
</template>
