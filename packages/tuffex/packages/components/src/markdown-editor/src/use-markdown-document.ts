import type { MarkdownEditorComment, MarkdownEditorSelection, MarkdownTextChange } from './types'
import { shallowRef, toRaw } from 'vue'
import { anchorMarkdownComments, mapMarkdownComments } from './comment-anchors'
import { MarkdownHistory } from './markdown-history'
import { applyMarkdownChanges, diffMarkdown, mapMarkdownPosition, normalizeChanges } from './text-changes'

/**
 * The one document every mode edits, and the order things happen in when it
 * changes.
 *
 * Every change — typed in a view, made by a command, undone, received from a
 * peer, replaced by the parent — goes through `commit`. A commit updates the
 * history, the comment ranges and every stored selection, tells the host,
 * writes the change into the active view unless that view made it, and only
 * then sends it to peers, so they receive changes in document order.
 *
 * Commits never nest. One requested while another runs (a transport echoing
 * synchronously, a view rebasing its own pending input over an incoming
 * change) is relative to the document the running commit produces, so it
 * waits for it; a view reporting while the shell writes into it goes first.
 */

export interface MarkdownCommit {
  changes: MarkdownTextChange[]
  /** `record`: a local edit, undoable. `rebase`: someone else's, the history moves around it. */
  history: 'record' | 'rebase' | 'none'
  before?: MarkdownEditorSelection | null
  after?: MarkdownEditorSelection | null
  /** Steps of one group join while they come quickly: a run of typing. */
  group?: string | null
  /** The view that already shows the change. */
  origin?: string | null
  /** Where the active view puts the selection afterwards. */
  selection?: MarkdownEditorSelection | null
  /** Send to peers. */
  send?: boolean
  /** Report through `update:modelValue` and `change`. @default true */
  emit?: boolean
  /** Look for detached threads' quotes again: undo, or a replaced document, may have brought them back. */
  reanchor?: boolean
}

export interface MarkdownDocumentHooks {
  /** The document changed; the views have not been told yet. */
  applied: (changes: MarkdownTextChange[], commit: MarkdownCommit) => void
  /** Writes the change into the active view. */
  sync: (changes: MarkdownTextChange[], commit: MarkdownCommit) => void
  send: (changes: MarkdownTextChange[]) => void
  threads: (threads: MarkdownEditorComment[]) => void
}

function mapRange(range: MarkdownEditorSelection, changes: readonly MarkdownTextChange[]): void {
  if (range.anchor === range.head) {
    range.anchor = range.head = mapMarkdownPosition(range.head, changes, 1)
    return
  }
  // Text typed at either edge stays outside the range.
  const forward = range.anchor < range.head
  const from = mapMarkdownPosition(forward ? range.anchor : range.head, changes, 1)
  const to = Math.max(from, mapMarkdownPosition(forward ? range.head : range.anchor, changes, -1))
  range.anchor = forward ? from : to
  range.head = forward ? to : from
}

export function useMarkdownDocument(initial: string, hooks: MarkdownDocumentHooks) {
  let doc = initial
  /** The document, for templates; `doc()` is the same without the dependency. */
  const text = shallowRef(initial)
  const threads = shallowRef<MarkdownEditorComment[]>([])
  const canUndo = shallowRef(false)
  const canRedo = shallowRef(false)
  const history = new MarkdownHistory()
  const tracked = new Set<MarkdownEditorSelection>()
  let ownThreads: MarkdownEditorComment[] | null = null

  const queue: MarkdownCommit[] = []
  let front: MarkdownCommit[] = []
  let committing = false
  let syncing = false

  function refreshHistory(): void {
    canUndo.value = history.canUndo
    canRedo.value = history.canRedo
  }

  function setThreads(next: MarkdownEditorComment[]): void {
    threads.value = next
    ownThreads = next
    hooks.threads(next)
  }

  /**
   * Threads from the parent; the editor's own emission comes back and is
   * ignored, also when a `ref` in the parent wrapped it in a proxy.
   */
  function loadThreads(next: MarkdownEditorComment[]): void {
    const raw = toRaw(next)
    if (raw === ownThreads)
      return
    threads.value = raw
    const anchored = anchorMarkdownComments(raw, doc)
    if (anchored)
      setThreads(anchored)
  }

  function apply(commit: MarkdownCommit): void {
    const changes = normalizeChanges(commit.changes)
    const before = doc
    const after = applyMarkdownChanges(before, changes)
    if (!changes.length || after === before)
      return
    if (commit.history === 'record')
      history.record(before, changes, commit.before ?? null, commit.after ?? null, commit.group ?? null)
    else if (commit.history === 'rebase')
      history.rebase(changes, before.length)
    doc = after
    text.value = after

    if (threads.value.length) {
      let next = mapMarkdownComments(threads.value, changes, after)
      if (commit.reanchor)
        next = anchorMarkdownComments(next ?? threads.value, after) ?? next
      if (next)
        setThreads(next)
    }
    for (const range of tracked)
      mapRange(range, changes)
    refreshHistory()

    hooks.applied(changes, commit)
    syncing = true
    try {
      hooks.sync(changes, commit)
    }
    finally {
      syncing = false
    }
    if (commit.send)
      hooks.send(changes)
  }

  function commit(next: MarkdownCommit): void {
    if (syncing)
      front.push(next)
    else
      queue.push(next)
    if (committing)
      return
    committing = true
    try {
      for (let current = queue.shift(); current; current = queue.shift()) {
        apply(current)
        if (front.length) {
          queue.unshift(...front)
          front = []
        }
      }
    }
    finally {
      committing = false
      front = []
      queue.length = 0
    }
  }

  /** Takes back the last local step; the selection it restores, or false when there was none. */
  function step(direction: 'undo' | 'redo'): MarkdownEditorSelection | null | false {
    // Peers' edits can rebase a step down to nothing: skip those.
    for (;;) {
      const entry = direction === 'undo' ? history.undo() : history.redo()
      if (!entry) {
        refreshHistory()
        return false
      }
      if (!entry.changes.length)
        continue
      commit({ changes: entry.changes, history: 'none', selection: entry.selection, send: true, reanchor: true })
      refreshHistory()
      return entry.selection
    }
  }

  /** Replaces the document with `value` as one change from elsewhere. */
  function replace(value: string, options: { send?: boolean, emit?: boolean } = {}): void {
    const change = diffMarkdown(doc, value)
    if (change)
      commit({ changes: [change], history: 'rebase', send: options.send, emit: options.emit, reanchor: true })
  }

  /** A selection the document keeps in step with every change until `untrack`. */
  function track(selection: MarkdownEditorSelection): MarkdownEditorSelection {
    const range = { anchor: selection.anchor, head: selection.head }
    tracked.add(range)
    return range
  }

  return {
    text,
    threads,
    canUndo,
    canRedo,
    doc: () => doc,
    commit,
    replace,
    undo: () => step('undo'),
    redo: () => step('redo'),
    /** Ends the current typing run. */
    seal: () => history.seal(),
    setThreads,
    loadThreads,
    track,
    untrack: (range: MarkdownEditorSelection) => tracked.delete(range),
  }
}
