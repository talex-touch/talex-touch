import type { EditorRangeMark } from './editor-overlay'
import type { MarkdownEdit } from './markdown-format'
import type { MarkdownEditorAi, MarkdownEditorAiAction, MarkdownEditorSelection } from './types'
import { onBeforeUnmount, shallowRef } from 'vue'
import { formatMarkdown } from './markdown-format'

/**
 * Rewrites selected text with the host's AI. A session holds the text, tracked
 * through every edit while it is open, and the answer as it streams in. The
 * answer goes into the document only when the user takes it, in place of the
 * text or as a block below it, as one undo step; the text it wrote then
 * lights up for a moment.
 */

/** `compose`: the user is choosing what to ask. */
export type MarkdownAiStatus = 'compose' | 'waiting' | 'streaming' | 'done' | 'failed'

export interface MarkdownAiSession {
  status: MarkdownAiStatus
  /** What was asked; null until something is. */
  action: MarkdownEditorAiAction | null
  instruction: string
  /** The text the answer rewrites. */
  original: string
  /** The answer so far, trimmed once it is finished. */
  answer: string
}

export interface MarkdownAiOptions {
  ai: () => MarkdownEditorAi | undefined
  doc: () => string
  track: (selection: MarkdownEditorSelection) => MarkdownEditorSelection
  untrack: (range: MarkdownEditorSelection) => void
  /** Applies a local edit as one undo step and puts the caret at its selection. */
  commit: (edit: MarkdownEdit, before: MarkdownEditorSelection) => void
  /** Where the block holding `pos` ends: an answer inserted below goes there. */
  blockEnd: (pos: number) => number
  /** Gives the editor its focus and `selection` back. */
  restore: (selection: MarkdownEditorSelection) => void
  /** The marks changed. */
  repaint: () => void
  onError: (error: unknown) => void
}

/** How much of the document on either side goes with a request. */
const CONTEXT = 2000
/** How long the text an answer wrote stays lit: its lines light up in turn, then fade. */
const FLASH_MS = 2000

function isAsyncIterable(value: unknown): value is AsyncIterable<string> {
  return !!value && typeof (value as AsyncIterable<string>)[Symbol.asyncIterator] === 'function'
}

export function useMarkdownAi(options: MarkdownAiOptions) {
  const session = shallowRef<MarkdownAiSession | null>(null)
  /** The text being rewritten, kept in step with edits. */
  let range: MarkdownEditorSelection | null = null
  /** The running request; replaced or cleared, it is stale. */
  let controller: AbortController | null = null
  let flash: { range: MarkdownEditorSelection, timer: ReturnType<typeof setTimeout> } | null = null

  function span(selection: MarkdownEditorSelection): [number, number] {
    return [Math.min(selection.anchor, selection.head), Math.max(selection.anchor, selection.head)]
  }

  function set(patch: Partial<MarkdownAiSession>): void {
    const current = session.value
    if (!current)
      return
    session.value = { ...current, ...patch }
    if (patch.status && patch.status !== current.status)
      options.repaint()
  }

  function abort(): void {
    controller?.abort()
    controller = null
  }

  /** Closes the session; returns the text it was on. */
  function close(): MarkdownEditorSelection | null {
    abort()
    const kept = range && { anchor: range.anchor, head: range.head }
    if (range)
      options.untrack(range)
    range = null
    if (session.value) {
      session.value = null
      options.repaint()
    }
    return kept
  }

  /** Opens on `selection` less the spaces around it, which the answer leaves where they are; false when that is nothing. */
  function open(selection: MarkdownEditorSelection): boolean {
    const doc = options.doc()
    let [from, to] = span(selection)
    while (from < to && /\s/.test(doc[from]!))
      from++
    while (to > from && /\s/.test(doc[to - 1]!))
      to--
    if (from === to)
      return false
    close()
    clearFlash()
    range = options.track({ anchor: from, head: to })
    session.value = { status: 'compose', action: null, instruction: '', original: doc.slice(from, to), answer: '' }
    options.repaint()
    return true
  }

  async function run(action: MarkdownEditorAiAction, instruction = ''): Promise<void> {
    const handler = options.ai()
    if (!handler || !session.value || !range)
      return
    abort()
    const own = new AbortController()
    controller = own
    const stale = (): boolean => controller !== own
    const doc = options.doc()
    const [from, to] = span(range)
    const text = doc.slice(from, to)
    set({ status: 'waiting', action, instruction, original: text, answer: '' })
    let answer = ''
    try {
      const result = handler({
        action,
        instruction,
        text,
        before: doc.slice(Math.max(0, from - CONTEXT), from),
        after: doc.slice(to, to + CONTEXT),
        signal: own.signal,
      })
      if (isAsyncIterable(result)) {
        const iterator = result[Symbol.asyncIterator]()
        for (;;) {
          const next = await iterator.next()
          if (stale()) {
            // Lets a generator run its `finally`.
            Promise.resolve(iterator.return?.()).catch(() => {})
            return
          }
          if (next.done)
            break
          answer += next.value
          set({ status: 'streaming', answer })
        }
      }
      else {
        answer = await result
        if (stale())
          return
      }
    }
    catch (error) {
      if (stale())
        return
      controller = null
      set({ status: 'failed' })
      options.onError(error)
      return
    }
    controller = null
    const finished = String(answer ?? '').replace(/\r\n?/g, '\n').trim()
    set(finished ? { status: 'done', answer: finished } : { status: 'failed', answer: '' })
  }

  /** Stops the answer where it is; with nothing written yet, back to asking. */
  function stop(): void {
    const current = session.value
    if (current?.status !== 'waiting' && current?.status !== 'streaming')
      return
    abort()
    const answer = current.answer.trim()
    set(answer ? { status: 'done', answer } : { status: 'compose', answer: '' })
  }

  function retry(): void {
    const current = session.value
    if (current?.action)
      void run(current.action, current.instruction)
  }

  /** Puts the answer in place of the text, or `below` the block it is in. */
  function accept(below = false): void {
    const current = session.value
    if (current?.status !== 'done' || !range)
      return
    const text = current.answer
    const [from, to] = span(range)
    const edit = below
      ? formatMarkdown(options.doc(), { anchor: options.blockEnd(to), head: options.blockEnd(to) }, { type: 'insert', text, block: true })
      : { changes: [{ from, to, insert: text }], selection: { anchor: from + text.length, head: from + text.length } }
    close()
    if (!edit)
      return
    options.commit(edit, { anchor: from, head: to })
    const end = edit.selection.head
    flash = { range: options.track({ anchor: end - text.length, head: end }), timer: setTimeout(clearFlash, FLASH_MS) }
    options.repaint()
  }

  function clearFlash(): void {
    if (!flash)
      return
    clearTimeout(flash.timer)
    options.untrack(flash.range)
    flash = null
    options.repaint()
  }

  /** Throws the session away and gives the text its selection back. */
  function discard(): void {
    const kept = close()
    if (kept)
      options.restore(kept)
  }

  /** The text being rewritten, lit while the answer is on its way, and the text an answer just wrote. */
  function marks(): EditorRangeMark[] {
    const list: EditorRangeMark[] = []
    const status = session.value?.status
    if (status && range) {
      const [from, to] = span(range)
      list.push({ id: 'ai', from, to, kind: 'ai', active: status === 'waiting' || status === 'streaming' })
    }
    if (flash) {
      const [from, to] = span(flash.range)
      list.push({ id: 'ai-done', from, to, kind: 'ai-done' })
    }
    return list
  }

  onBeforeUnmount(() => {
    abort()
    if (flash)
      clearTimeout(flash.timer)
  })

  return { session, open, run, stop, retry, accept, discard, close, marks }
}

export type MarkdownAi = ReturnType<typeof useMarkdownAi>
