import type { MarkdownEditorSelection, MarkdownTextChange } from './types'
import {
  changeLengthDelta,
  composeMarkdownChanges,
  invertMarkdownChanges,
  mapMarkdownPosition,
  normalizeChanges,
  transformMarkdownChanges,
} from './text-changes'

/**
 * Undo and redo as change sets, shared by every mode.
 *
 * Only local edits are recorded. A peer's edit rebases both stacks instead,
 * so undo takes back what this user did and leaves everyone else's text in
 * place. Typing in one run joins a single step until it pauses.
 */

interface HistoryEntry {
  /** Against the document before the step. */
  changes: MarkdownTextChange[]
  /** Against the document after the step. */
  inverse: MarkdownTextChange[]
  before: MarkdownEditorSelection | null
  after: MarkdownEditorSelection | null
  time: number
  /** Steps in the same group join while they come quickly; null never joins. */
  group: string | null
}

export interface MarkdownHistoryStep {
  changes: MarkdownTextChange[]
  selection: MarkdownEditorSelection | null
}

function sameSelection(a: MarkdownEditorSelection, b: MarkdownEditorSelection): boolean {
  return a.anchor === b.anchor && a.head === b.head
}

function mapSelection(selection: MarkdownEditorSelection | null, changes: readonly MarkdownTextChange[]): MarkdownEditorSelection | null {
  if (!selection || !changes.length)
    return selection
  return {
    anchor: mapMarkdownPosition(selection.anchor, changes, 1),
    head: mapMarkdownPosition(selection.head, changes, 1),
  }
}

export class MarkdownHistory {
  private done: HistoryEntry[] = []
  private undone: HistoryEntry[] = []
  private readonly limit: number
  private readonly delay: number

  constructor(limit = 300, delay = 700) {
    this.limit = limit
    this.delay = delay
  }

  get canUndo(): boolean {
    return this.done.length > 0
  }

  get canRedo(): boolean {
    return this.undone.length > 0
  }

  clear(): void {
    this.done = []
    this.undone = []
  }

  /** A local edit of `doc`. */
  record(
    doc: string,
    changes: readonly MarkdownTextChange[],
    before: MarkdownEditorSelection | null,
    after: MarkdownEditorSelection | null,
    group: string | null,
    time = Date.now(),
  ): void {
    const forward = normalizeChanges(changes)
    if (!forward.length)
      return
    const inverse = invertMarkdownChanges(doc, forward)
    this.undone = []
    const last = this.done[this.done.length - 1]
    const joins = last && group && last.group === group && time - last.time < this.delay
      && (!before || !last.after || sameSelection(before, last.after))
    if (last && joins) {
      const lengthBeforeLast = doc.length + changeLengthDelta(last.inverse)
      last.changes = composeMarkdownChanges(last.changes, forward, lengthBeforeLast)
      last.inverse = composeMarkdownChanges(inverse, last.inverse, doc.length + changeLengthDelta(forward))
      last.after = after
      last.time = time
      return
    }
    this.done.push({ changes: forward, inverse, before, after, time, group })
    if (this.done.length > this.limit)
      this.done.shift()
  }

  /** Ends the current typing run: the next edit starts a step of its own. */
  seal(): void {
    const last = this.done[this.done.length - 1]
    if (last)
      last.group = null
  }

  undo(): MarkdownHistoryStep | null {
    const entry = this.done.pop()
    if (!entry)
      return null
    this.undone.push(entry)
    return { changes: entry.inverse, selection: entry.before }
  }

  redo(): MarkdownHistoryStep | null {
    const entry = this.undone.pop()
    if (!entry)
      return null
    this.done.push(entry)
    return { changes: entry.changes, selection: entry.after }
  }

  /** A change from elsewhere was applied to the current document, `docLength` long before it. */
  rebase(remote: readonly MarkdownTextChange[], docLength: number): void {
    const incoming = normalizeChanges(remote)
    if (!incoming.length)
      return

    // Newest step first: its inverse applies to the current document, and
    // undoing it leaves the document the next one's inverse applies to.
    let pending = incoming
    let length = docLength
    for (let index = this.done.length - 1; index >= 0 && pending.length; index--) {
      const entry = this.done[index]!
      const lengthBefore = length + changeLengthDelta(entry.inverse)
      const [inverse, below] = transformMarkdownChanges(entry.inverse, pending, length)
      const [changes] = transformMarkdownChanges(entry.changes, below, lengthBefore)
      entry.after = mapSelection(entry.after, pending)
      entry.before = mapSelection(entry.before, below)
      entry.inverse = inverse
      entry.changes = changes
      entry.group = null
      pending = below
      length = lengthBefore
    }

    // The next redo applies to the current document, and so on upward.
    pending = incoming
    length = docLength
    for (let index = this.undone.length - 1; index >= 0 && pending.length; index--) {
      const entry = this.undone[index]!
      const lengthAfter = length + changeLengthDelta(entry.changes)
      const [changes, above] = transformMarkdownChanges(entry.changes, pending, length)
      const [inverse] = transformMarkdownChanges(entry.inverse, above, lengthAfter)
      entry.before = mapSelection(entry.before, pending)
      entry.after = mapSelection(entry.after, above)
      entry.changes = changes
      entry.inverse = inverse
      pending = above
      length = lengthAfter
    }
  }
}
