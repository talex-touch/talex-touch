import type { BlockView } from './block-view'

/**
 * What the editor draws over the text that is not part of it: comment
 * highlights, other people's carets and selections, and the text an AI
 * rewrite is working on or has just written. The source mode turns
 * these into CodeMirror decorations; the rich surface and the preview lay them
 * out as boxes over the rendered blocks, because marking up a contenteditable
 * would make the marks part of what the user edits.
 */

export interface EditorCommentMark {
  id: string
  from: number
  to: number
  active: boolean
}

export interface EditorPeerMark {
  id: string
  name: string
  color: string
  anchor: number
  head: number
  /** Show the name tag: the peer moved or typed a moment ago. */
  labelled: boolean
}

/** Text an AI rewrite is on (`ai`), or has just written (`ai-done`). */
export interface EditorRangeMark {
  id: string
  from: number
  to: number
  kind: 'ai' | 'ai-done'
  /** The answer is on its way. */
  active?: boolean
}

export interface EditorOverlay {
  comments: EditorCommentMark[]
  peers: EditorPeerMark[]
  /** Rich surface only. */
  marks?: EditorRangeMark[]
}

export interface OverlayBox {
  key: string
  kind: 'comment' | 'selection' | 'caret' | EditorRangeMark['kind']
  left: number
  top: number
  width: number
  height: number
  active?: boolean
  color?: string
  /** Ranges: the box's line among the range's, the first few apart, for an entrance in turn. */
  order?: number
  /** Carets: the name tag. */
  label?: string
  labelled?: boolean
}

export const EMPTY_OVERLAY: EditorOverlay = { comments: [], peers: [] }

const PEER_COLORS = ['#e5484d', '#3e63dd', '#30a46c', '#f76b15', '#8e4ec6', '#0d74ce', '#d6409f', '#ad7f58']

/** A stable colour for a user without one. */
export function peerColor(id: string): string {
  let hash = 0
  for (let index = 0; index < id.length; index++)
    hash = (hash * 31 + id.charCodeAt(index)) | 0
  return PEER_COLORS[Math.abs(hash) % PEER_COLORS.length]!
}

/** Boxes for `overlay` over `view`, in the coordinates of `pane` (an ancestor that scrolls with the text). */
export function layoutOverlay(view: BlockView, pane: HTMLElement, overlay: EditorOverlay): OverlayBox[] {
  const marks = overlay.marks ?? []
  if (!view.items.length || (!overlay.comments.length && !overlay.peers.length && !marks.length))
    return []
  const origin = pane.getBoundingClientRect()
  const length = view.doc.length
  const boxes: OverlayBox[] = []
  const clamp = (pos: number) => Math.max(0, Math.min(length, pos))
  const ranges = (key: string, from: number, to: number, box: Omit<OverlayBox, 'key' | 'left' | 'top' | 'width' | 'height'>) => {
    view.rangeRects(clamp(from), clamp(to)).forEach((rect, index) => {
      if (rect.width <= 0 || rect.height <= 0)
        return
      boxes.push({
        ...box,
        key: `${key}:${index}`,
        order: Math.min(index, 6),
        left: rect.left - origin.left,
        top: rect.top - origin.top,
        width: rect.width,
        height: rect.height,
      })
    })
  }

  for (const comment of overlay.comments) {
    if (comment.to > comment.from)
      ranges(`c:${comment.id}`, comment.from, comment.to, { kind: 'comment', active: comment.active })
  }
  for (const mark of marks) {
    if (mark.to > mark.from)
      ranges(`m:${mark.id}`, mark.from, mark.to, { kind: mark.kind, active: mark.active })
  }
  for (const peer of overlay.peers) {
    const from = Math.min(peer.anchor, peer.head)
    const to = Math.max(peer.anchor, peer.head)
    if (to > from)
      ranges(`s:${peer.id}`, from, to, { kind: 'selection', color: peer.color })
    const caret = view.caretRect(clamp(peer.head))
    if (caret && caret.height > 0) {
      boxes.push({
        key: `p:${peer.id}`,
        kind: 'caret',
        left: caret.left - origin.left,
        top: caret.top - origin.top,
        width: 2,
        height: caret.height,
        color: peer.color,
        label: peer.name,
        labelled: peer.labelled,
      })
    }
  }
  return boxes
}
