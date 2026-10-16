import type { EditorPeerMark } from './editor-overlay'
import type {
  MarkdownEditorCollaboration,
  MarkdownEditorPeer,
  MarkdownEditorPresence,
  MarkdownTextChange,
} from './types'
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'
import { peerColor } from './editor-overlay'
import { mapMarkdownPosition } from './text-changes'

/**
 * The editor's side of a collaboration session: the subscription, the peers'
 * carets and the throttled presence.
 *
 * A peer's selection arrives relative to the document it was sent against, and
 * the text keeps moving under it until the next update — so every applied
 * change, local or remote, maps the stored selections along. A caret shows its
 * name tag for a moment after it moves.
 */

export interface MarkdownCollaborationOptions {
  collaboration: () => MarkdownEditorCollaboration | undefined
  /** Remote changes, relative to the current document. */
  onRemote: (changes: MarkdownTextChange[]) => void
  presence: () => MarkdownEditorPresence
}

interface PeerState {
  peer: MarkdownEditorPeer
  color: string
  /** Epoch milliseconds until which the name tag shows. */
  labelledUntil: number
}

const PRESENCE_INTERVAL = 50
const LABEL_DURATION = 2500

function sameSelection(a: MarkdownEditorPeer['selection'], b: MarkdownEditorPeer['selection']): boolean {
  return a?.anchor === b?.anchor && a?.head === b?.head
}

export function useMarkdownCollaboration(options: MarkdownCollaborationOptions) {
  const states = shallowRef<PeerState[]>([])
  /** Bumped when a name tag expires. */
  const clock = shallowRef(0)
  let unsubscribe: (() => void) | null = null
  let labelTimer: ReturnType<typeof setTimeout> | null = null
  let presenceTimer: ReturnType<typeof setTimeout> | null = null
  let presenceSentAt = 0
  let lastPresence = ''

  const peers = computed(() => states.value.map(state => ({ ...state.peer, color: state.color })))

  const marks = computed<EditorPeerMark[]>(() => {
    void clock.value
    const now = Date.now()
    return states.value
      .filter(state => state.peer.selection)
      .map(state => ({
        id: state.peer.id,
        name: state.peer.name,
        color: state.color,
        anchor: state.peer.selection!.anchor,
        head: state.peer.selection!.head,
        labelled: state.labelledUntil > now,
      }))
  })

  function scheduleLabels(): void {
    if (labelTimer)
      clearTimeout(labelTimer)
    labelTimer = null
    const now = Date.now()
    const next = Math.min(...states.value.map(state => state.labelledUntil).filter(until => until > now))
    if (Number.isFinite(next)) {
      labelTimer = setTimeout(() => {
        clock.value++
        scheduleLabels()
      }, next - now + 16)
    }
  }

  function setPeers(list: MarkdownEditorPeer[]): void {
    const previous = new Map(states.value.map(state => [state.peer.id, state]))
    const now = Date.now()
    states.value = list.map((peer) => {
      const before = previous.get(peer.id)
      const moved = !before || !sameSelection(before.peer.selection, peer.selection)
      return {
        peer,
        color: peer.color || peerColor(peer.id),
        labelledUntil: moved && peer.selection ? now + LABEL_DURATION : before?.labelledUntil ?? 0,
      }
    })
    scheduleLabels()
  }

  /** Moves the peers' selections through a change applied to the document. */
  function mapPeers(changes: readonly MarkdownTextChange[]): void {
    if (!changes.length || !states.value.some(state => state.peer.selection))
      return
    states.value = states.value.map((state) => {
      const selection = state.peer.selection
      if (!selection)
        return state
      const anchor = mapMarkdownPosition(selection.anchor, changes, 1)
      const head = mapMarkdownPosition(selection.head, changes, 1)
      if (anchor === selection.anchor && head === selection.head)
        return state
      return { ...state, peer: { ...state.peer, selection: { anchor, head } } }
    })
  }

  function send(changes: MarkdownTextChange[]): void {
    if (changes.length)
      options.collaboration()?.send(changes)
  }

  function flushPresence(): void {
    presenceTimer = null
    const collaboration = options.collaboration()
    if (!collaboration?.sendPresence)
      return
    const presence = options.presence()
    const key = JSON.stringify(presence)
    if (key === lastPresence)
      return
    lastPresence = key
    presenceSentAt = Date.now()
    collaboration.sendPresence(presence)
  }

  /** The local caret or mode changed: tell the others, at most every 50 ms. */
  function presenceChanged(): void {
    if (!options.collaboration()?.sendPresence || presenceTimer)
      return
    const wait = PRESENCE_INTERVAL - (Date.now() - presenceSentAt)
    if (wait <= 0)
      flushPresence()
    else
      presenceTimer = setTimeout(flushPresence, wait)
  }

  function stop(): void {
    unsubscribe?.()
    unsubscribe = null
    if (presenceTimer)
      clearTimeout(presenceTimer)
    presenceTimer = null
    lastPresence = ''
    states.value = []
    scheduleLabels()
  }

  function start(collaboration: MarkdownEditorCollaboration | undefined): void {
    stop()
    if (!collaboration)
      return
    unsubscribe = collaboration.subscribe({
      onChanges: changes => options.onRemote(changes),
      onPeers: list => setPeers(list),
    })
    presenceChanged()
  }

  watch(options.collaboration, start)

  onBeforeUnmount(() => {
    stop()
    if (labelTimer)
      clearTimeout(labelTimer)
  })

  return { peers, marks, start, send, mapPeers, presenceChanged }
}
