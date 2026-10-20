import { ref } from 'vue'
import { useTuffTransport } from '@talex-touch/utils/transport'
import { AgentWorkspaceEvents } from '@talex-touch/utils/transport/sdk/domains/agent-workspace'

/**
 * Global reactive set of conversation IDs currently loading / generating.
 * Using a reactive Set triggered via reassignment to guarantee Vue template reactivity.
 */
const loadingConversationIds = ref<Set<string>>(new Set())
let workspaceEventsCleanup: (() => void) | null = null

export function isConversationLoading(id: string | null | undefined): boolean {
  if (!id) return false
  return loadingConversationIds.value.has(id)
}

export function setConversationLoading(id: string, loading: boolean): void {
  if (!id) return
  const current = new Set(loadingConversationIds.value)
  if (loading) {
    current.add(id)
  } else {
    current.delete(id)
  }
  loadingConversationIds.value = current
}

export function resetConversationLoading(): void {
  loadingConversationIds.value = new Set()
  if (workspaceEventsCleanup) {
    workspaceEventsCleanup()
    workspaceEventsCleanup = null
  }
}

export function useConversationLoading() {
  try {
    const transport = useTuffTransport()
    if (transport && !workspaceEventsCleanup) {
      workspaceEventsCleanup = transport.on(AgentWorkspaceEvents.changed, (state) => {
        if (!state?.conversationId) return
        if (state.status === 'running' || state.status === 'pending_approval') {
          setConversationLoading(state.conversationId, true)
        } else {
          setConversationLoading(state.conversationId, false)
        }
      })
    }
  } catch {
    // Transport may not be injected in headless unit tests
  }

  return {
    loadingConversationIds,
    isConversationLoading,
    setConversationLoading,
    resetConversationLoading
  }
}
