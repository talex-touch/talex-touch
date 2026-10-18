/**
 * The numbers behind a learning curve: TensorBoard's debiased exponential
 * moving average, the mean and spread of several seeds of one run, and the
 * indices worth drawing when a run has more points than the plot has pixels.
 */

export type CurvePoint = readonly [step: number, value: number]

/**
 * Debiased exponential moving average, as TensorBoard smooths scalars.
 * `weight` 0 leaves the values as they are; 0.99 smooths hardest. Early
 * values are not dragged towards zero (the debiasing), and a non-finite value
 * passes through without feeding the average.
 */
export function smoothEma(values: readonly number[], weight: number): number[] {
  const w = Math.min(0.999, Math.max(0, Number.isFinite(weight) ? weight : 0))
  const first = values[0]
  // A constant series stays exactly constant, free of rounding from the average.
  if (w === 0 || values.every(value => value === first))
    return [...values]
  const smoothed: number[] = Array.from({ length: values.length })
  let last = 0
  let count = 0
  for (let index = 0; index < values.length; index++) {
    const value = values[index]!
    if (!Number.isFinite(value)) {
      smoothed[index] = value
      continue
    }
    last = last * w + (1 - w) * value
    count++
    smoothed[index] = last / (1 - w ** count)
  }
  return smoothed
}

/** A run as drawn: its steps, and per step the raw and smoothed values and the seeds' spread. */
export interface RunCurve {
  /** Steps the run has a value at, ascending. */
  steps: number[]
  /** The value, or the mean of the seeds' values. */
  raw: number[]
  /** The smoothed value, or the mean of the smoothed seeds. */
  smoothed: number[]
  /** Standard deviation of the smoothed seeds at each step; `null` for a single seed. */
  spread: number[] | null
}

function ordered(points: ReadonlyArray<CurvePoint>): CurvePoint[] {
  const list = points.filter(point => Number.isFinite(point[0]))
  for (let index = 1; index < list.length; index++) {
    if (list[index]![0] < list[index - 1]![0])
      return list.sort((a, b) => a[0] - b[0])
  }
  return list
}

/**
 * One seed's values at `steps`: exact where it logged that step (its last
 * value there), linearly interpolated between its own steps, and `NaN` outside
 * the range it covers.
 */
function resample(seedSteps: readonly number[], values: readonly number[], steps: readonly number[]): number[] {
  const out: number[] = Array.from({ length: steps.length })
  let next = 0
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]!
    while (next < seedSteps.length && seedSteps[next]! <= step)
      next++
    const before = next - 1
    if (before < 0 || (next >= seedSteps.length && seedSteps[before]! < step)) {
      out[index] = Number.NaN
    }
    else if (seedSteps[before] === step) {
      out[index] = values[before]!
    }
    else {
      const x0 = seedSteps[before]!
      const x1 = seedSteps[next]!
      const t = (step - x0) / (x1 - x0)
      out[index] = values[before]! + (values[next]! - values[before]!) * t
    }
  }
  return out
}

/**
 * Smooths each seed, then reads them all at the union of their steps: the mean
 * of the raw values, the mean of the smoothed ones, and the smoothed seeds'
 * population standard deviation (NumPy's default, the usual "± std over
 * seeds"). A step only one seed reaches has a spread of zero there.
 */
export function aggregateSeeds(seeds: ReadonlyArray<ReadonlyArray<CurvePoint>>, weight: number): RunCurve {
  const lists = seeds.map(ordered).filter(list => list.length > 0)
  if (lists.length === 0)
    return { steps: [], raw: [], smoothed: [], spread: null }
  if (lists.length === 1) {
    const list = lists[0]!
    const raw = list.map(point => point[1])
    return { steps: list.map(point => point[0]), raw, smoothed: smoothEma(raw, weight), spread: null }
  }

  const union = lists.flatMap(list => list.map(point => point[0])).sort((a, b) => a - b)
  const steps = union.filter((step, index) => index === 0 || step !== union[index - 1])
  const rawBySeed: number[][] = []
  const smoothBySeed: number[][] = []
  for (const list of lists) {
    const seedSteps = list.map(point => point[0])
    const values = list.map(point => point[1])
    rawBySeed.push(resample(seedSteps, values, steps))
    smoothBySeed.push(resample(seedSteps, smoothEma(values, weight), steps))
  }

  const raw: number[] = []
  const smoothed: number[] = []
  const spread: number[] = []
  for (let index = 0; index < steps.length; index++) {
    let rawSum = 0
    let rawCount = 0
    let sum = 0
    let squares = 0
    let count = 0
    for (let seed = 0; seed < lists.length; seed++) {
      const rawValue = rawBySeed[seed]![index]!
      if (Number.isFinite(rawValue)) {
        rawSum += rawValue
        rawCount++
      }
      const value = smoothBySeed[seed]![index]!
      if (Number.isFinite(value)) {
        sum += value
        squares += value * value
        count++
      }
    }
    raw.push(rawCount > 0 ? rawSum / rawCount : Number.NaN)
    const mean = count > 0 ? sum / count : Number.NaN
    smoothed.push(mean)
    spread.push(count > 0 ? Math.sqrt(Math.max(0, squares / count - mean * mean)) : Number.NaN)
  }
  return { steps, raw, smoothed, spread }
}

/** First index whose step is at least `value` (`steps.length` when none is). */
export function lowerBound(steps: readonly number[], value: number): number {
  let lo = 0
  let hi = steps.length
  while (lo < hi) {
    const middle = (lo + hi) >> 1
    if (steps[middle]! < value)
      lo = middle + 1
    else
      hi = middle
  }
  return lo
}

/** Index of the step nearest `value`, or -1 for an empty run. */
export function nearestIndex(steps: readonly number[], value: number): number {
  if (steps.length === 0)
    return -1
  const after = Math.min(steps.length - 1, lowerBound(steps, value))
  const before = Math.max(0, after - 1)
  return Math.abs(steps[before]! - value) <= Math.abs(steps[after]! - value) ? before : after
}

/**
 * The indices between `from` and `to` (inclusive) worth drawing: everything
 * when they fit, otherwise per pixel column the first, last, lowest and
 * highest point of each value array (M4), which draws the same picture.
 */
export function drawnIndices(
  from: number,
  to: number,
  toPx: (index: number) => number,
  values: ReadonlyArray<readonly number[]>,
  pixels: number,
): number[] {
  const all: number[] = []
  if (to < from)
    return all
  if (to - from + 1 <= pixels * 4) {
    for (let index = from; index <= to; index++)
      all.push(index)
    return all
  }
  const kept = new Set<number>()
  let column = Number.NaN
  let first = from
  let last = from
  const low: number[] = []
  const high: number[] = []
  const flush = (): void => {
    kept.add(first)
    kept.add(last)
    for (const index of low)
      kept.add(index)
    for (const index of high)
      kept.add(index)
  }
  for (let index = from; index <= to; index++) {
    const px = Math.floor(toPx(index))
    if (px !== column) {
      if (!Number.isNaN(column))
        flush()
      column = px
      first = index
      low.length = 0
      high.length = 0
      for (let series = 0; series < values.length; series++) {
        low.push(index)
        high.push(index)
      }
    }
    last = index
    for (let series = 0; series < values.length; series++) {
      const value = values[series]![index]!
      if (value < values[series]![low[series]!]!)
        low[series] = index
      if (value > values[series]![high[series]!]!)
        high[series] = index
    }
  }
  flush()
  return [...kept].sort((a, b) => a - b)
}
