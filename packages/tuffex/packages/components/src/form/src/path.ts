import { isReactive, toRaw } from 'vue'

type Container = Record<string, any>

const parsed = new Map<string, string[]>()

/**
 * Splits `meta.links[0].url` into `['meta', 'links', '0', 'url']`. Array
 * indexes stay strings: arrays accept them as keys, and a schema issue's
 * numeric segment compares equal once both sides go through `toPathKey`.
 */
export function parsePath(path: string): string[] {
  let segments = parsed.get(path)
  if (!segments) {
    segments = path.replace(/\[(\w+)\]/g, '.$1').split('.').filter(Boolean)
    parsed.set(path, segments)
  }
  return segments
}

/** One spelling per path, so `links[0]` and `links.0` name the same field. */
export function toPathKey(path: string | ReadonlyArray<PropertyKey>): string {
  return typeof path === 'string' ? parsePath(path).join('.') : path.map(String).join('.')
}

export function getPath(source: unknown, path: string): any {
  let current: any = source
  for (const segment of parsePath(path)) {
    if (current === null || typeof current !== 'object')
      return undefined
    current = current[segment]
  }
  return current
}

export function hasPath(source: unknown, path: string): boolean {
  let current: any = source
  for (const segment of parsePath(path)) {
    if (current === null || typeof current !== 'object' || !(segment in current))
      return false
    current = current[segment]
  }
  return true
}

/** Creates the containers a nested path needs: an array for a numeric segment, an object otherwise. */
export function setPath(target: Container, path: string, value: unknown): void {
  const segments = parsePath(path)
  let current: Container = target
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      current[segment] = value
      return
    }
    const next = current[segment]
    if (next === null || typeof next !== 'object')
      current[segment] = /^\d+$/.test(segments[index + 1] ?? '') ? [] : {}
    current = current[segment]
  })
}

export function isPlainObject(value: unknown): value is Container {
  if (value === null || typeof value !== 'object')
    return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Deep copy of plain data. Other objects — a `File`, a class instance — are
 * shared, because copying them is either impossible or not what a baseline
 * means. `structuredClone` is not used: it throws on the reactive proxies a
 * model is made of.
 */
export function cloneValue<T>(value: T): T {
  const raw: any = isReactive(value) ? toRaw(value) : value
  if (Array.isArray(raw))
    return raw.map(item => cloneValue(item)) as T
  if (raw instanceof Date)
    return new Date(raw.getTime()) as T
  if (isPlainObject(raw)) {
    const copy: Container = {}
    for (const key of Object.keys(raw))
      copy[key] = cloneValue(raw[key])
    return copy as T
  }
  return raw
}

/**
 * Paths whose value differs from the baseline. Plain objects are walked; an
 * array or any other value is one field. Keys the baseline does not have are
 * skipped: they are host state added after the form took its baseline, and
 * counting them would leave the form dirty with nothing for the user to save.
 *
 * It reads through the model's proxies rather than `toRaw`, so a `computed`
 * built on it follows every edit.
 */
export function collectChangedPaths(current: unknown, baseline: unknown, prefix = '', out: string[] = []): string[] {
  if (isPlainObject(current) && isPlainObject(baseline)) {
    for (const key of Object.keys(baseline))
      collectChangedPaths(current[key], baseline[key], prefix ? `${prefix}.${key}` : key, out)
    return out
  }
  if (prefix && !isEqualValue(current, baseline))
    out.push(prefix)
  return out
}

export function isEqualValue(left: any, right: any): boolean {
  if (Object.is(left, right))
    return true
  if (left instanceof Date && right instanceof Date)
    return left.getTime() === right.getTime()
  if (Array.isArray(left) && Array.isArray(right))
    return left.length === right.length && left.every((item, index) => isEqualValue(item, right[index]))
  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = Object.keys(left)
    return keys.length === Object.keys(right).length
      && keys.every(key => Object.prototype.hasOwnProperty.call(right, key) && isEqualValue(left[key], right[key]))
  }
  return false
}

/**
 * Writes `source` into `target` through its proxies. Plain objects present on
 * both sides are filled in place, so a host holding `form.meta` keeps a live
 * reference; anything else is replaced. Keys `source` lacks are left alone.
 */
export function assignInto(target: Container, source: Container): void {
  for (const key of Object.keys(source)) {
    const next = source[key]
    const current = target[key]
    if (isPlainObject(next) && isPlainObject(current))
      assignInto(current, next)
    else
      target[key] = next
  }
}

/** `links.0.url` becomes `links-0-url`: a path as it can sit inside an element id. */
export function toIdSegment(pathKey: string): string {
  return pathKey.replace(/[^\w-]+/g, '-')
}
