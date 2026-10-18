import { useRouter } from 'vue-router'
import { useProjectStore } from '~/stores/projects'

/**
 * The one way into a conversation.
 *
 * Browser header, project rows, the chats section and keyboard commands share the same
 * "claim the owner, then go Home" sequence so project ownership cannot drift between entries.
 */
export function useConversationEntry() {
  const router = useRouter()
  const projectStore = useProjectStore()

  /**
   * A blank conversation, owned by `projectId` when the caller has one.
   *
   * The push is unconditional: HomePage's watcher is what
   * consumes the pending owner, and `push('/home')` while already there is a duplicate navigation
   * Vue Router discards. Deciding "are we already Home?" here would mean duplicating HomePage's
   * route test (`/home` and `/home/c/:id`), and getting that wrong strands the new conversation —
   * the owner is claimed but nothing navigates to read it.
   */
  async function enterConversation(projectId: string | null): Promise<void> {
    projectStore.beginConversation(projectId)
    await router.push('/home')
  }

  /** The folder picker, then the same entry — only when the user actually picked a folder. */
  async function enterPickedProjectConversation(): Promise<void> {
    const project = await projectStore.selectDirectory()
    if (!project) return
    await enterConversation(project.id)
  }

  return { enterConversation, enterPickedProjectConversation }
}
