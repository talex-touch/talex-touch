/**
 * Main-process event-loop lag, aggregated for telemetry.
 *
 * Fed by PerfMonitor's 100 ms tick, the one timer already watching the loop; a sample is how late
 * that tick fired beyond its schedule. Telemetry used to run a second sampler, a 20 ms
 * `monitorEventLoopDelay`: about 110 extra context switches a second on an idle app, and every
 * sample it recorded included its own 20 ms interval (Node records resolution + delay in
 * interval mode), so its "p95 delay" sat near 22 ms on a loop that was not lagging at all.
 *
 * Everything kept here is additive — sample count, counts at or over fixed thresholds, sum, max —
 * so windows from any number of devices and days merge into fleet figures on the server. A
 * client-side percentile cannot be merged: averaging per-client p95 values is not a p95.
 */
export interface EventLoopLagWindow {
  samples: number
  over50: number
  over100: number
  over250: number
  over1000: number
  totalMs: number
  maxMs: number
}

function emptyWindow(): EventLoopLagWindow {
  return { samples: 0, over50: 0, over100: 0, over250: 0, over1000: 0, totalMs: 0, maxMs: 0 }
}

let current = emptyWindow()

export function recordEventLoopLagSample(lagMs: number): void {
  const lag = Math.max(0, lagMs)
  current.samples += 1
  current.totalMs += lag
  if (lag > current.maxMs) current.maxMs = lag
  if (lag >= 50) current.over50 += 1
  if (lag >= 100) current.over100 += 1
  if (lag >= 250) current.over250 += 1
  if (lag >= 1000) current.over1000 += 1
}

/** Returns the samples recorded since the previous call and starts a new window. */
export function takeEventLoopLagWindow(): EventLoopLagWindow {
  const taken = current
  current = emptyWindow()
  return taken
}
