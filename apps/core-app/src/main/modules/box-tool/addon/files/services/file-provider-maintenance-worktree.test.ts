import { afterEach, describe, expect, it } from 'vitest'
import { FileProviderMaintenanceService } from './file-provider-maintenance-service'

/**
 * The cleanup sweep evicts files of a linked worktree below a watch root, like the scan skips
 * them, and records the worktree's `.git` file as the evidence the deletion checks again.
 */
const services: FileProviderMaintenanceService[] = []

function createService(isWorktreeRoot: (directory: string) => Promise<boolean>) {
  const unsupported = (): never => {
    throw new Error('unsupported in this test')
  }
  const service = new FileProviderMaintenanceService({
    sourceId: 'file-provider',
    getDbUtils: () => null,
    getSearchIndex: () => null,
    getFilePersistencePort: unsupported,
    getRuntimeMutationDelegate: unsupported,
    isSplitEnabled: () => true,
    isShuttingDown: () => false,
    isInitializing: () => false,
    isWithinWatchRoots: () => true,
    normalizePath: (value) => value,
    mapRecord: unsupported,
    onBaseCommitReady: () => undefined,
    emitCleanupProgress: () => undefined,
    isLinkedWorktreeRoot: isWorktreeRoot,
    logInfo: () => undefined,
    logDebug: () => undefined,
    logWarn: () => undefined
  })
  services.push(service)
  return service
}

afterEach(async () => {
  for (const service of services.splice(0)) await service.stop()
})

describe('cleanup sweep and linked worktrees', () => {
  const worktree = '/Users/someone/Workspace/app-feature'
  const isWorktreeRoot = async (directory: string): Promise<boolean> => directory === worktree

  it('evicts a file inside a linked worktree below a watch root, with its .git as evidence', async () => {
    const service = createService(isWorktreeRoot)
    service.updateConfiguration(['/Users/someone'], [])

    expect(await service.classifyExcludedCleanupPath(`${worktree}/src/index.ts`)).toBe(true)
    expect(service.isSearchPathAdmitted(`${worktree}/src/index.ts`)).toBe(false)
    const evidence = (service as unknown as { cleanupFilterEvidence: Map<string, string[]> })
      .cleanupFilterEvidence
    expect(evidence.get(`${worktree}/src/index.ts`)).toEqual([`${worktree}/.git`])
  })

  it('keeps a worktree the user added as a monitored path', async () => {
    const service = createService(isWorktreeRoot)
    service.updateConfiguration(['/Users/someone'], [worktree])

    expect(await service.classifyExcludedCleanupPath(`${worktree}/src/index.ts`)).toBe(false)
  })
})
