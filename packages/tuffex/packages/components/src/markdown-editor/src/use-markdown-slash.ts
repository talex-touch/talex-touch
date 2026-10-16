import type { MarkdownEdit, MarkdownFormatAction } from './markdown-format'
import type { RichSurface } from './rich-surface'
import type { MarkdownEditorLabels, MarkdownEditorSelection, MarkdownEditorToolbarActionKey } from './types'
import type { MarkdownBox } from './use-markdown-overlay'
import { computed, nextTick, shallowRef } from 'vue'
import { calloutTitles } from './markdown-callout'
import { formatMarkdown } from './markdown-format'
import { applyMarkdownChanges, composeMarkdownChanges } from './text-changes'
import { MARKDOWN_EDITOR_ACTION_ICONS, MARKDOWN_EDITOR_CALLOUT_ICONS } from './toolbar-icons'
import { MARKDOWN_EDITOR_CALLOUT_TYPES } from './types'
import { boxIn, virtualReference } from './use-markdown-overlay'

/**
 * Slash commands on the rich surface. `/` first in a paragraph — or `、`,
 * which a Chinese input method types for it — opens a menu of blocks, and
 * what follows filters it. Picking one takes the `/query` out and turns the
 * paragraph into that block, in one undo step; the formula and the image ask
 * for theirs first. The source mode has Markdown itself for this.
 */

export interface MarkdownSlashCommand {
  id: string
  label: string
  /** The Markdown it makes, beside the label. */
  hint: string
  icon?: string
  /** In place of an icon: H1, H2, H3. */
  glyph?: string
  /** Lowercase words it is also found by. */
  keywords: string
  /** The edit; without one the editor asks for more first: the formula, the image. */
  action?: MarkdownFormatAction
}

export interface MarkdownSlashOptions {
  /** The rich surface, while commands apply to it: active, editable, slash on. */
  surface: () => RichSurface | null
  /** The element the menu is anchored in. */
  page: () => HTMLElement | null
  labels: () => MarkdownEditorLabels
  /** The editor's actions: a command is offered when its action is. */
  actions: () => readonly MarkdownEditorToolbarActionKey[]
  callouts: () => boolean
  doc: () => string
  track: (selection: MarkdownEditorSelection) => MarkdownEditorSelection
  untrack: (range: MarkdownEditorSelection) => void
  /** Applies a local edit as one undo step and puts the caret at its selection. */
  commit: (edit: MarkdownEdit, before: MarkdownEditorSelection) => void
  /** A command without an edit asks first; what it makes takes the place of `range`, the `/query`. */
  ask: (id: string, range: MarkdownEditorSelection) => void
  /** The menu's anchor moved. */
  reposition: () => void
}

export interface MarkdownSlashState {
  /** The `/query`, kept in step with edits. */
  range: MarkdownEditorSelection
  query: string
  items: MarkdownSlashCommand[]
  active: number
}

/** The slash, then a query of anything but spaces. */
const TRIGGER = /^[/、]([^\s/、]{0,24})$/

function catalogue(labels: MarkdownEditorLabels, actions: readonly MarkdownEditorToolbarActionKey[], callouts: boolean): MarkdownSlashCommand[] {
  const offered = new Set(actions)
  const commands: MarkdownSlashCommand[] = []
  const add = (key: MarkdownEditorToolbarActionKey, command: Omit<MarkdownSlashCommand, 'id' | 'label' | 'icon'> & Partial<MarkdownSlashCommand>) => {
    if (offered.has(key))
      commands.push({ id: key, label: labels[key], icon: MARKDOWN_EDITOR_ACTION_ICONS[key], ...command })
  }
  for (const level of [1, 2, 3] as const) {
    add('heading', {
      id: `heading${level}`,
      label: labels[`heading${level}`],
      icon: undefined,
      glyph: `H${level}`,
      hint: '#'.repeat(level),
      keywords: `h${level} heading title`,
      action: { type: 'heading', level },
    })
  }
  add('bulletList', { hint: '-', keywords: 'ul bullet unordered list', action: { type: 'bulletList' } })
  add('orderedList', { hint: '1.', keywords: 'ol numbered ordered list', action: { type: 'orderedList' } })
  add('taskList', { hint: '[ ]', keywords: 'todo task checkbox list', action: { type: 'taskList' } })
  add('quote', { hint: '>', keywords: 'quote blockquote', action: { type: 'quote' } })
  if (callouts) {
    const titles = calloutTitles(labels)
    for (const type of MARKDOWN_EDITOR_CALLOUT_TYPES) {
      commands.push({
        id: `callout-${type}`,
        label: titles[type],
        icon: MARKDOWN_EDITOR_CALLOUT_ICONS[type],
        hint: `[!${type.toUpperCase()}]`,
        keywords: `callout alert ${type}`,
        action: { type: 'callout', callout: type },
      })
    }
  }
  add('codeBlock', { hint: '```', keywords: 'code pre fence snippet', action: { type: 'codeBlock' } })
  add('math', { hint: '$$', keywords: 'math latex tex katex formula equation' })
  add('table', { hint: '|', keywords: 'table grid', action: { type: 'table', header: labels.tableColumn } })
  add('divider', { hint: '---', keywords: 'divider hr rule line separator', action: { type: 'divider' } })
  add('image', { hint: '![]', keywords: 'image img picture photo' })
  return commands
}

/** The commands `query` finds: those with a word starting with it, then those holding it. */
function search(commands: MarkdownSlashCommand[], query: string): MarkdownSlashCommand[] {
  if (!query)
    return commands
  const first: MarkdownSlashCommand[] = []
  const then: MarkdownSlashCommand[] = []
  for (const command of commands) {
    const text = `${command.label} ${command.hint} ${command.keywords}`.toLowerCase()
    if (text.split(/\s+/).some(word => word.startsWith(query)))
      first.push(command)
    else if (text.includes(query))
      then.push(command)
  }
  return [...first, ...then]
}

export function useMarkdownSlash(options: MarkdownSlashOptions) {
  const slash = shallowRef<MarkdownSlashState | null>(null)
  const box = shallowRef<MarkdownBox | null>(null)
  const reference = virtualReference(options.page, () => box.value)
  const commands = computed(() => catalogue(options.labels(), options.actions(), options.callouts()))
  /** The slash whose menu Escape closed: it stays a slash. */
  let dismissed: MarkdownEditorSelection | null = null

  function close(): void {
    if (!slash.value)
      return
    options.untrack(slash.value.range)
    slash.value = null
  }

  function forget(): void {
    if (dismissed)
      options.untrack(dismissed)
    dismissed = null
  }

  /** The `/query` before the caret, first in a top-level paragraph: elsewhere a slash is only a slash. */
  function trigger(surface: RichSurface): { node: Text, offset: number, query: string } | null {
    const before = surface.textBeforeCaret()
    const paragraph = before?.node.parentNode
    if (!before || paragraph?.nodeName !== 'P' || paragraph.parentNode !== surface.root || before.node.previousSibling)
      return null
    const match = TRIGGER.exec(before.text)
    return match ? { node: before.node, offset: before.offset, query: match[1]!.toLowerCase() } : null
  }

  /** After typing (`typed`) the menu may open; a moved caret only refines or closes an open one. */
  function update(typed: boolean): void {
    const surface = options.surface()
    if (!surface) {
      close()
      forget()
      return
    }
    // The input method owns the text until it commits it.
    if (surface.isComposing)
      return
    const found = trigger(surface)
    const [from, to] = found ? surface.textRange(found.node, 0, found.offset) : [-1, -1]
    if (dismissed && dismissed.anchor !== from)
      forget()
    const items = found && !dismissed && (typed || slash.value) ? search(commands.value, found.query) : []
    if (!found || !items.length) {
      close()
      return
    }
    const kept = slash.value?.query === found.query ? slash.value.active : 0
    if (slash.value)
      options.untrack(slash.value.range)
    slash.value = { range: options.track({ anchor: from, head: to }), query: found.query, items, active: Math.min(kept, items.length - 1) }
    // Anchored at the slash, so the menu stays put while the query grows.
    const range = found.node.ownerDocument.createRange()
    range.setStart(found.node, 0)
    range.setEnd(found.node, 1)
    const measured = range.getBoundingClientRect()
    const rect = measured.height > 0 ? measured : surface.selectionRect()
    const page = options.page()
    box.value = page && rect ? boxIn(page, rect) : null
    void nextTick(options.reposition)
  }

  /** The surface's keydown, while the menu is open; true when the menu took it. */
  function keydown(event: KeyboardEvent): boolean {
    const state = slash.value
    if (!state || event.isComposing)
      return false
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey
    if (plain && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      const step = event.key === 'ArrowDown' ? 1 : -1
      slash.value = { ...state, active: (state.active + step + state.items.length) % state.items.length }
      return true
    }
    if (plain && !event.shiftKey && (event.key === 'Enter' || event.key === 'Tab')) {
      pick(state.active)
      return true
    }
    if (event.key === 'Escape') {
      forget()
      dismissed = options.track({ anchor: state.range.anchor, head: state.range.anchor })
      close()
      return true
    }
    return false
  }

  function pick(position: number): void {
    const command = slash.value?.items[position]
    const surface = options.surface()
    if (!command || !surface)
      return
    surface.flush()
    // Read after the flush: it may have moved the range.
    const range = slash.value?.range
    close()
    if (!range)
      return
    const from = Math.min(range.anchor, range.head)
    const to = Math.max(range.anchor, range.head)
    // Until it is answered, the `/query` stays: taken out, the empty line it
    // is on would have nothing in the source to hold it.
    if (!command.action) {
      options.ask(command.id, { anchor: from, head: to })
      return
    }
    const removal = [{ from, to, insert: '' }]
    const doc = options.doc()
    const caret = { anchor: from, head: from }
    const edit = formatMarkdown(applyMarkdownChanges(doc, removal), caret, command.action)
    options.commit({
      changes: edit ? composeMarkdownChanges(removal, edit.changes, doc.length) : removal,
      selection: edit?.selection ?? caret,
    }, { anchor: to, head: to })
  }

  function hover(position: number): void {
    if (slash.value)
      slash.value = { ...slash.value, active: position }
  }

  return { slash, reference, close, update, keydown, pick, hover }
}
