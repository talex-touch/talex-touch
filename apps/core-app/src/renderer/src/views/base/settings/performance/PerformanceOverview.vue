<script setup lang="ts">
import type { PerformanceResourceReport } from '@talex-touch/utils/transport/events/types'
import type { PerformanceHistoryPoint } from './usePerformanceReport'
import { TxCard } from '@talex-touch/tuffex/card'
import { TxSkeleton } from '@talex-touch/tuffex/skeleton'
import { TxSparkChart } from '@talex-touch/tuffex/spark-chart'
import { TxStatCard } from '@talex-touch/tuffex/stat-card'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatMemory, formatPercent, formatRate } from './format'

const props = defineProps<{
  report: PerformanceResourceReport | null
  history: PerformanceHistoryPoint[]
  pending: boolean
  skeleton: boolean
}>()
const { t } = useI18n()
const stats = computed(() => [
  {
    key: 'cpu',
    value: props.report ? formatPercent(props.report.totals.cpuPercent) : '—',
    meta: props.report
      ? t('settingPerformance.cpuShare', {
          share: formatPercent(
            props.report.totals.cpuPercent / Math.max(1, props.report.logicalCpuCount)
          ),
          cores: props.report.logicalCpuCount
        })
      : t('settingPerformance.cpuNote')
  },
  { key: 'memory', value: props.report ? formatMemory(props.report.totals.workingSetBytes) : '—' },
  {
    key: 'wakeups',
    value: props.report ? formatRate(props.report.totals.idleWakeupsPerSecond) : '—'
  },
  {
    key: 'mainThreadCpu',
    value: props.report ? formatPercent(props.report.mainThread.cpuPercent) : '—'
  },
  { key: 'processCount', value: props.report?.processes.length ?? '—' },
  { key: 'workerCount', value: props.report?.workers.length ?? '—' }
])
const trends = computed(() => [
  {
    key: 'cpu',
    value: stats.value[0].value,
    data: props.history.map((point) => ({ time: point.capturedAt / 1000, value: point.cpuPercent }))
  },
  {
    key: 'memory',
    value: stats.value[1].value,
    data: props.history.map((point) => ({
      time: point.capturedAt / 1000,
      value: point.workingSetBytes
    }))
  },
  {
    key: 'mainThreadCpu',
    value: stats.value[3].value,
    data: props.history
      .filter((point) => point.mainThreadCpuPercent !== null)
      .map((point) => ({ time: point.capturedAt / 1000, value: point.mainThreadCpuPercent! }))
  }
])
</script>

<template>
  <section
    class="flex flex-col gap-3"
    :aria-label="t('settingPerformance.overview')"
    :aria-busy="pending"
  >
    <h2 class="text-base font-semibold">{{ t('settingPerformance.overview') }}</h2>
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <TxStatCard
        v-for="stat in stats"
        :key="stat.key"
        :label="t(`settingPerformance.metrics.${stat.key}`)"
        :value="stat.value"
        :meta="stat.meta"
      >
        <template #value>
          <div class="h-[1lh]">
            <TxSkeleton v-if="pending && skeleton" width="100px" height="1lh" aria-hidden="true" />
            <span v-else-if="!pending">{{ stat.value }}</span>
          </div>
        </template>
      </TxStatCard>
    </div>
  </section>
  <section class="flex flex-col gap-3" :aria-label="t('settingPerformance.trends')">
    <div>
      <h2 class="text-base font-semibold">{{ t('settingPerformance.trends') }}</h2>
      <p>{{ t('settingPerformance.historyNote') }}</p>
    </div>
    <div class="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <TxCard v-for="trend in trends" :key="trend.key" background="refraction" :padding="16">
        <div class="flex items-center justify-between gap-2">
          <h3 class="font-medium">{{ t(`settingPerformance.metrics.${trend.key}`) }}</h3>
          <span v-if="!pending" class="tabular-nums">{{ trend.value }}</span>
          <TxSkeleton v-else-if="skeleton" width="50px" height="1lh" aria-hidden="true" />
        </div>
        <div class="h-24">
          <TxSkeleton v-if="pending && skeleton" width="100%" height="96px" aria-hidden="true" />
          <TxSparkChart
            v-else-if="!pending && trend.data.length"
            class="h-full"
            :series="[
              {
                id: trend.key,
                label: t(`settingPerformance.metrics.${trend.key}`),
                data: trend.data
              }
            ]"
            :animation="false"
            :interactive="false"
            :aria-label="t(`settingPerformance.metrics.${trend.key}`)"
            :domain="trend.key === 'mainThreadCpu' ? [0, 100] : undefined"
          />
          <p v-else-if="!pending" class="pt-6">{{ t('settingPerformance.trendEmpty') }}</p>
        </div>
      </TxCard>
    </div>
  </section>
</template>
