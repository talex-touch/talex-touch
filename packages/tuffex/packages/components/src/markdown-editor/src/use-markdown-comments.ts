import type { Ref } from 'vue'
import type { EditorCommentMark } from './editor-overlay'
import type { MarkdownEditorComment, MarkdownEditorCommentReply, MarkdownEditorSelection, MarkdownEditorUser } from './types'
import { computed, ref } from 'vue'
import { isCommentDetached } from './comment-anchors'

/**
 * Comment threads: writing, answering, resolving and deleting them, which one
 * is active, and the highlights they draw. Their ranges belong to the
 * document, which moves them with every change.
 */

export interface MarkdownCommentsOptions {
  enabled: () => boolean
  /** Threads can be read, not changed. */
  locked: () => boolean
  user: () => MarkdownEditorUser
  threads: Readonly<Ref<MarkdownEditorComment[]>>
  setThreads: (next: MarkdownEditorComment[]) => void
  doc: () => string
  /** The text a new comment is being written about. */
  pending: () => MarkdownEditorSelection | null
  reveal: (pos: number) => void
  events: {
    create: (comment: MarkdownEditorComment) => void
    reply: (comment: MarkdownEditorComment, reply: MarkdownEditorCommentReply) => void
    resolve: (comment: MarkdownEditorComment) => void
    delete: (comment: MarkdownEditorComment) => void
  }
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function useMarkdownComments(options: MarkdownCommentsOptions) {
  const { threads } = options
  const activeThread = ref<string | null>(null)
  const sidebarOpen = ref(false)
  const openCount = computed(() => threads.value.filter(thread => !thread.resolved).length)

  function marks(): EditorCommentMark[] {
    if (!options.enabled())
      return []
    const out: EditorCommentMark[] = []
    for (const thread of threads.value) {
      if (!thread.resolved && !isCommentDetached(thread))
        out.push({ id: thread.id, from: thread.from, to: thread.to, active: thread.id === activeThread.value })
    }
    // The text a new comment is about, while its field has the focus.
    const pending = options.pending()
    if (pending && pending.anchor !== pending.head)
      out.push({ id: '', from: Math.min(pending.anchor, pending.head), to: Math.max(pending.anchor, pending.head), active: true })
    return out
  }

  function create(selection: MarkdownEditorSelection, body: string): MarkdownEditorComment | null {
    const from = Math.min(selection.anchor, selection.head)
    const to = Math.max(selection.anchor, selection.head)
    if (to <= from || options.locked())
      return null
    const user = options.user()
    const comment: MarkdownEditorComment = {
      id: newId(),
      from,
      to,
      quote: options.doc().slice(from, to),
      author: { ...user },
      body,
      createdAt: Date.now(),
      replies: [],
    }
    options.setThreads([...threads.value, comment])
    options.events.create(comment)
    activeThread.value = comment.id
    sidebarOpen.value = true
    return comment
  }

  function update(id: string, change: (thread: MarkdownEditorComment) => MarkdownEditorComment): MarkdownEditorComment | null {
    const thread = threads.value.find(item => item.id === id)
    if (!thread || options.locked())
      return null
    const next = change(thread)
    options.setThreads(threads.value.map(item => (item.id === id ? next : item)))
    return next
  }

  function reply(id: string, body: string): void {
    const answer: MarkdownEditorCommentReply = { id: newId(), author: { ...options.user() }, body, createdAt: Date.now() }
    const next = update(id, thread => ({ ...thread, replies: [...(thread.replies ?? []), answer] }))
    if (next)
      options.events.reply(next, answer)
  }

  function resolve(id: string, resolved: boolean): void {
    const next = update(id, thread => ({ ...thread, resolved }))
    if (!next)
      return
    if (resolved && activeThread.value === id)
      activeThread.value = null
    options.events.resolve(next)
  }

  function remove(id: string): void {
    const thread = threads.value.find(item => item.id === id)
    if (!thread || options.locked())
      return
    options.setThreads(threads.value.filter(item => item.id !== id))
    if (activeThread.value === id)
      activeThread.value = null
    options.events.delete(thread)
  }

  function activate(id: string): void {
    activeThread.value = id
    const thread = threads.value.find(item => item.id === id)
    if (thread && !isCommentDetached(thread))
      options.reveal(thread.from)
  }

  /** The innermost open thread under the caret becomes the active one. */
  function followCaret(selection: MarkdownEditorSelection): void {
    if (!options.enabled())
      return
    let best: MarkdownEditorComment | null = null
    for (const thread of threads.value) {
      if (thread.resolved || isCommentDetached(thread) || selection.head < thread.from || selection.head > thread.to)
        continue
      if (!best || thread.to - thread.from < best.to - best.from)
        best = thread
    }
    activeThread.value = best?.id ?? null
  }

  /** A click at `caret` on commented text opens its thread. */
  function openAt(caret: MarkdownEditorSelection): void {
    followCaret(caret)
    if (activeThread.value)
      sidebarOpen.value = true
  }

  return { activeThread, sidebarOpen, openCount, marks, create, reply, resolve, remove, activate, followCaret, openAt }
}
