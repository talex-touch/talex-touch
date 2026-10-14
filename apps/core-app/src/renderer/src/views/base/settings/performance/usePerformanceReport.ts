import type {
  PerformanceProcessTreeReport,
  PerformanceResourceReport
} from '@talex-touch/utils/transport/events/types'
import { useTuffTransport } from '@talex-touch/utils/transport'
import { AppEvents } from '@talex-touch/utils/transport/events'
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, shallowRef } from 'vue'

export interface PerformanceHistoryPoint {
  capturedAt: number
  cpuPercent: number
  workingSetBytes: number
  mainThreadCpuPercent: number | null
}

const POLL_MS = 2000
const HISTORY_SIZE = 60

/** Page-owned, single-flight sampling. No host subscription or background sampler. */
export function usePerformanceReport() {
  const transport = useTuffTransport()
  const report = shallowRef<PerformanceResourceReport | null>(null)
  const history = shallowRef<PerformanceHistoryPoint[]>([])
  const processTree = shallowRef<PerformanceProcessTreeReport | null>(null)
  const error = ref(false)
  const treeError = ref(false)
  const loading = ref(false)
  const treeLoading = ref(false)
  const paused = ref(false)
  const active = ref(false)
  const visible = ref(false)
  const sampling = computed(() => active.value && visible.value && !paused.value)
  const ring = new Array<PerformanceHistoryPoint>(HISTORY_SIZE)
  let cursor = 0
  let count = 0
  let timer: number | undefined
  let inFlight = false
  let disposed = false
  let revision = 0
  let nextAllowedAt = 0

  function stopTimer(): void {
    window.clearTimeout(timer)
    timer = undefined
  }

  function remember(value: PerformanceResourceReport): void {
    if (history.value.at(-1)?.capturedAt === value.capturedAt) return
    ring[cursor] = {
      capturedAt: value.capturedAt,
      cpuPercent: value.totals.cpuPercent,
      workingSetBytes: value.totals.workingSetBytes,
      mainThreadCpuPercent: value.mainThread.cpuPercent
    }
    cursor = (cursor + 1) % HISTORY_SIZE
    count = Math.min(count + 1, HISTORY_SIZE)
    history.value = Array.from(
      { length: count },
      (_, index) => ring[(cursor - count + index + HISTORY_SIZE) % HISTORY_SIZE]
    )
  }

  function schedule(): void {
    if (!sampling.value || disposed || inFlight || timer !== undefined) return
    timer = window.setTimeout(
      () => {
        timer = undefined
        void collect()
      },
      Math.max(0, nextAllowedAt - Date.now())
    )
  }

  async function collect(): Promise<void> {
    if (!sampling.value || disposed || inFlight) return
    inFlight = true
    loading.value = true
    const requestRevision = revision
    try {
      const value = await transport.send(AppEvents.performance.getReport)
      if (requestRevision === revision && sampling.value && !disposed) {
        report.value = value
        remember(value)
        error.value = false
      }
    } catch {
      if (requestRevision === revision && sampling.value && !disposed) error.value = true
    } finally {
      inFlight = false
      loading.value = false
      // Success and failure share the same delay; retry and reactivation cannot overlap a request.
      nextAllowedAt = Date.now() + POLL_MS
      schedule()
    }
  }

  function sync(): void {
    if (!sampling.value) {
      revision += 1
      stopTimer()
      return
    }
    schedule()
  }

  function setActive(value: boolean): void {
    active.value = value
    visible.value = document.visibilityState === 'visible'
    sync()
  }

  function onVisibilityChange(): void {
    visible.value = document.visibilityState === 'visible'
    sync()
  }

  function togglePaused(): void {
    paused.value = !paused.value
    sync()
  }

  function retry(): void {
    stopTimer()
    schedule()
  }

  // This function is invoked only by the page's explicit deep-sampling button.
  async function sampleProcessTree(): Promise<void> {
    if (treeLoading.value || !active.value || !visible.value || disposed) return
    treeLoading.value = true
    treeError.value = false
    try {
      const value = await transport.send(AppEvents.performance.getProcessTree)
      if (!disposed) processTree.value = value
    } catch {
      if (!disposed) treeError.value = true
    } finally {
      treeLoading.value = false
    }
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibilityChange)
    setActive(true)
  })
  onActivated(() => setActive(true))
  onDeactivated(() => setActive(false))
  onUnmounted(() => {
    disposed = true
    setActive(false)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  return {
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
  }
}
