import type { MarkdownTextChange } from './types'

/**
 * Change-set algebra for the editor and for collaboration adapters.
 *
 * A change set is simultaneous: every offset refers to the document before it
 * applies. `transform` and `compose` go through the retain / insert / delete
 * form of ot.js, where the tie-breaking rules are well understood, and convert
 * back, so the public shape stays CodeMirror's `{ from, to, insert }`.
 */

type Op = number | string

function isRetain(op: Op | undefined): op is number {
  return typeof op === 'number' && op > 0
}

function isDelete(op: Op | undefined): op is number {
  return typeof op === 'number' && op < 0
}

function isInsert(op: Op | undefined): op is string {
  return typeof op === 'string'
}

function pushOp(ops: Op[], op: Op): void {
  if (op === 0 || op === '')
    return
  const last = ops[ops.length - 1]
  if (typeof op === 'string' && typeof last === 'string')
    ops[ops.length - 1] = last + op
  else if (typeof op === 'number' && typeof last === 'number' && Math.sign(op) === Math.sign(last))
    ops[ops.length - 1] = last + op
  else
    ops.push(op)
}

/** Sorted by position; drops no-ops. Overlapping changes are a caller bug and are clipped. */
export function normalizeChanges(changes: readonly MarkdownTextChange[]): MarkdownTextChange[] {
  const sorted = changes
    .filter(change => change.to > change.from || change.insert.length > 0)
    .map(change => ({ from: Math.max(0, change.from), to: Math.max(change.from, change.to), insert: change.insert }))
    .sort((a, b) => a.from - b.from || a.to - b.to)
  let end = 0
  for (const change of sorted) {
    if (change.from < end)
      change.from = end
    if (change.to < change.from)
      change.to = change.from
    end = change.to
  }
  return sorted
}

export function changeLengthDelta(changes: readonly MarkdownTextChange[]): number {
  return changes.reduce((delta, change) => delta + change.insert.length - (change.to - change.from), 0)
}

export function applyMarkdownChanges(doc: string, changes: readonly MarkdownTextChange[]): string {
  let out = ''
  let pos = 0
  for (const change of normalizeChanges(changes)) {
    out += doc.slice(pos, change.from) + change.insert
    pos = Math.min(Math.max(change.to, pos), doc.length)
  }
  return out + doc.slice(pos)
}

/** The change set that undoes `changes`, relative to the document after them. */
export function invertMarkdownChanges(doc: string, changes: readonly MarkdownTextChange[]): MarkdownTextChange[] {
  let delta = 0
  return normalizeChanges(changes).map((change) => {
    const from = change.from + delta
    delta += change.insert.length - (change.to - change.from)
    return { from, to: from + change.insert.length, insert: doc.slice(change.from, change.to) }
  })
}

/**
 * Where `pos` lands after `changes`. A position inside a replaced span goes to
 * its start (`assoc` -1) or past the inserted text (`assoc` 1); a pure insert
 * at `pos` only pushes it along when `assoc` is 1.
 */
export function mapMarkdownPosition(pos: number, changes: readonly MarkdownTextChange[], assoc: -1 | 1 = -1): number {
  let delta = 0
  for (const change of normalizeChanges(changes)) {
    if (change.from > pos)
      break
    const size = change.to - change.from
    if (change.to < pos || (change.to === pos && size > 0)) {
      delta += change.insert.length - size
      continue
    }
    // change.from <= pos <= change.to
    if (size === 0)
      return assoc > 0 ? change.from + delta + change.insert.length : change.from + delta
    if (pos === change.from)
      return change.from + delta
    return assoc > 0 ? change.from + delta + change.insert.length : change.from + delta
  }
  return pos + delta
}

function toOps(changes: readonly MarkdownTextChange[], docLength: number): Op[] {
  const ops: Op[] = []
  let pos = 0
  for (const change of normalizeChanges(changes)) {
    const to = Math.min(change.to, docLength)
    const from = Math.min(change.from, to)
    pushOp(ops, from - pos)
    pushOp(ops, change.insert)
    pushOp(ops, -(to - from))
    pos = to
  }
  pushOp(ops, docLength - pos)
  return ops
}

function fromOps(ops: readonly Op[]): MarkdownTextChange[] {
  const changes: MarkdownTextChange[] = []
  let pos = 0
  let current: MarkdownTextChange | null = null
  for (const op of ops) {
    if (isRetain(op)) {
      if (current)
        changes.push(current)
      current = null
      pos += op
      continue
    }
    current ??= { from: pos, to: pos, insert: '' }
    if (isInsert(op)) {
      current.insert += op
    }
    else {
      current.to += -op
      pos += -op
    }
  }
  if (current)
    changes.push(current)
  return changes
}

function transformOps(a: readonly Op[], b: readonly Op[]): [Op[], Op[]] {
  const aPrime: Op[] = []
  const bPrime: Op[] = []
  let i = 0
  let j = 0
  let opA: Op | undefined = a[i++]
  let opB: Op | undefined = b[j++]

  while (opA !== undefined || opB !== undefined) {
    // Inserts never conflict; `a`'s go first on a tie, which is the whole
    // tie-breaking rule both ends of a session have to agree on.
    if (isInsert(opA)) {
      pushOp(aPrime, opA)
      pushOp(bPrime, opA.length)
      opA = a[i++]
      continue
    }
    if (isInsert(opB)) {
      pushOp(aPrime, opB.length)
      pushOp(bPrime, opB)
      opB = b[j++]
      continue
    }
    if (opA === undefined || opB === undefined)
      throw new Error('[TxMarkdownEditor] transform: change sets disagree on the document length')

    if (isRetain(opA) && isRetain(opB)) {
      const min = Math.min(opA, opB)
      pushOp(aPrime, min)
      pushOp(bPrime, min)
      opA = opA > min ? opA - min : a[i++]
      opB = opB > min ? opB - min : b[j++]
    }
    else if (isDelete(opA) && isDelete(opB)) {
      const min = Math.min(-opA, -opB)
      opA = -opA > min ? opA + min : a[i++]
      opB = -opB > min ? opB + min : b[j++]
    }
    else if (isDelete(opA) && isRetain(opB)) {
      const min = Math.min(-opA, opB)
      pushOp(aPrime, -min)
      opA = -opA > min ? opA + min : a[i++]
      opB = opB > min ? opB - min : b[j++]
    }
    else if (isRetain(opA) && isDelete(opB)) {
      const min = Math.min(opA, -opB)
      pushOp(bPrime, -min)
      opA = opA > min ? opA - min : a[i++]
      opB = -opB > min ? opB + min : b[j++]
    }
  }

  return [aPrime, bPrime]
}

function composeOps(a: readonly Op[], b: readonly Op[]): Op[] {
  const out: Op[] = []
  let i = 0
  let j = 0
  let opA: Op | undefined = a[i++]
  let opB: Op | undefined = b[j++]

  while (opA !== undefined || opB !== undefined) {
    if (isDelete(opA)) {
      pushOp(out, opA)
      opA = a[i++]
      continue
    }
    if (isInsert(opB)) {
      pushOp(out, opB)
      opB = b[j++]
      continue
    }
    if (opA === undefined || opB === undefined)
      throw new Error('[TxMarkdownEditor] compose: change sets disagree on the document length')

    if (isRetain(opA) && isRetain(opB)) {
      const min = Math.min(opA, opB)
      pushOp(out, min)
      opA = opA > min ? opA - min : a[i++]
      opB = opB > min ? opB - min : b[j++]
    }
    else if (isInsert(opA) && isDelete(opB)) {
      const min = Math.min(opA.length, -opB)
      opA = opA.length > min ? opA.slice(min) : a[i++]
      opB = -opB > min ? opB + min : b[j++]
    }
    else if (isInsert(opA) && isRetain(opB)) {
      const min = Math.min(opA.length, opB)
      pushOp(out, opA.slice(0, min))
      opA = opA.length > min ? opA.slice(min) : a[i++]
      opB = opB > min ? opB - min : b[j++]
    }
    else if (isRetain(opA) && isDelete(opB)) {
      const min = Math.min(opA, -opB)
      pushOp(out, -min)
      opA = opA > min ? opA - min : a[i++]
      opB = -opB > min ? opB + min : b[j++]
    }
  }

  return out
}

/**
 * Rebase two change sets made concurrently against one document of
 * `docLength`. Returns `[a', b']`: applying `a` then `b'` and `b` then `a'`
 * give the same text. On an insert tie, `a`'s text comes first.
 */
export function transformMarkdownChanges(
  a: readonly MarkdownTextChange[],
  b: readonly MarkdownTextChange[],
  docLength: number,
): [MarkdownTextChange[], MarkdownTextChange[]] {
  const [aPrime, bPrime] = transformOps(toOps(a, docLength), toOps(b, docLength))
  return [fromOps(aPrime), fromOps(bPrime)]
}

/** One change set equivalent to `a` followed by `b` (`b` relative to the document after `a`). */
export function composeMarkdownChanges(
  a: readonly MarkdownTextChange[],
  b: readonly MarkdownTextChange[],
  docLength: number,
): MarkdownTextChange[] {
  const afterA = docLength + changeLengthDelta(normalizeChanges(a))
  return fromOps(composeOps(toOps(a, docLength), toOps(b, afterA)))
}

/** The smallest single replacement turning `before` into `after`, or null when equal. */
export function diffMarkdown(before: string, after: string): MarkdownTextChange | null {
  if (before === after)
    return null
  const max = Math.min(before.length, after.length)
  let start = 0
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start))
    start++
  // Never split a surrogate pair: an emoji half-replaced is two broken glyphs.
  if (start > 0 && isHighSurrogate(before.charCodeAt(start - 1)))
    start--
  let endBefore = before.length
  let endAfter = after.length
  while (endBefore > start && endAfter > start && before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) {
    endBefore--
    endAfter--
  }
  if (endBefore < before.length && isLowSurrogate(before.charCodeAt(endBefore))) {
    endBefore++
    endAfter++
  }
  return { from: start, to: endBefore, insert: after.slice(start, endAfter) }
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xD800 && code <= 0xDBFF
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xDC00 && code <= 0xDFFF
}
