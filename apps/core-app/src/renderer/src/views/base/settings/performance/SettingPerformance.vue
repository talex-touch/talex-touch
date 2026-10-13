<script setup lang="ts">
import { TxButton } from '@talex-touch/tuffex/button'
import { TxCard } from '@talex-touch/tuffex/card'
import { TxSkeleton, useDeferredLoading } from '@talex-touch/tuffex/skeleton'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import PerformanceOverview from './PerformanceOverview.vue'
import PerformanceProcesses from './PerformanceProcesses.vue'
import PerformanceProcessTree from './PerformanceProcessTree.vue'
import PerformanceThreads from './PerformanceThreads.vue'
import { usePerformanceReport } from './usePerformanceReport'

const { t, locale } = useI18n()
const {
  report,
  history,
  processTree,
  error,
  treeError,
  loading,
  treeLoading,
  paused,
  sampling,
  togglePaused,
  retry,
  sampleProcessTree
} = usePerformanceReport()
const firstLoadPending = computed(() => !report.value && !error.value)
const showSkeleton = useDeferredLoading(() => firstLoadPending.value && sampling.value)
const pending = computed(() => firstLoadPending.value || (showSkeleton.value && !error.value))
const sampledAt = computed(() =>
  report.value ? new Date(report.value.capturedAt).toLocaleString(locale.value) : ''
)
</script>

<template>
  <div
    class="flex w-full flex-col gap-6 text-sm"
    :style="{ color: 'var(--tx-text-color-regular)' }"
  >
    <div class="flex flex-col gap-3">
      <p>{{ t('settingPerformance.samplingNote') }}</p>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-col gap-1">
          <p role="status">
            {{
              t(
                paused
                  ? 'settingPerformance.paused'
                  : sampling
                    ? 'settingPerformance.running'
                    : 'settingPerformance.inactive'
              )
            }}
          </p>
          <template v-if="report">
            <p>
              {{
                t('settingPerformance.sampleCost', {
                  collectMs: report.collectMs.toFixed(1),
                  windowMs: report.windowMs === null ? '—' : report.windowMs.toFixed(0)
                })
              }}
            </p>
            <p>{{ t('settingPerformance.capturedAt', { time: sampledAt }) }}</p>
          </template>
        </div>
        <TxButton :aria-pressed="paused" @click="togglePaused">
          {{ t(paused ? 'settingPerformance.resume' : 'settingPerformance.pause') }}
        </TxButton>
      </div>
      <div v-if="error" role="alert" class="flex flex-wrap items-center justify-between gap-3">
        <p :style="{ color: 'var(--tx-color-danger)' }">
          {{ t('settingPerformance.reportError') }}
        </p>
        <TxButton :disabled="loading || !sampling" @click="retry">{{
          t('settingPerformance.retry')
        }}</TxButton>
      </div>
    </div>
    <PerformanceOverview
      :report="report"
      :history="history"
      :pending="pending"
      :skeleton="showSkeleton && sampling"
    />
    <template v-if="report && !pending">
      <PerformanceProcesses :processes="report.processes" />
      <PerformanceThreads :report="report" />
    </template>
    <template v-else-if="pending">
      <section class="flex flex-col gap-3" :aria-busy="true">
        <h2 class="text-base font-semibold">{{ t('settingPerformance.processes') }}</h2>
        <p>{{ t('settingPerformance.processNote') }}</p>
        <TxSkeleton v-if="showSkeleton && sampling" width="100%" height="1lh" aria-hidden="true" />
      </section>
      <section class="flex flex-col gap-3" :aria-busy="true">
        <h2 class="text-base font-semibold">{{ t('settingPerformance.threads') }}</h2>
        <h3 class="font-medium">{{ t('settingPerformance.nodeWorkers') }}</h3>
        <p>{{ t('settingPerformance.workerNote') }}</p>
        <TxCard background="refraction" :padding="16">
          <div class="flex flex-col gap-2">
            <h3 class="font-semibold">{{ t('settingPerformance.nativeRuntimes') }}</h3>
            <template v-if="showSkeleton && sampling">
              <TxSkeleton width="80%" height="1lh" aria-hidden="true" />
              <TxSkeleton width="40%" height="1lh" aria-hidden="true" />
              <TxSkeleton width="100%" height="1lh" aria-hidden="true" />
            </template>
          </div>
        </TxCard>
      </section>
    </template>
    <PerformanceProcessTree
      :tree="processTree"
      :loading="treeLoading"
      :error="treeError"
      @sample="sampleProcessTree"
    />
  </div>
</template>
