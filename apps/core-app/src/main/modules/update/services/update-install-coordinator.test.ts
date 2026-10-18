import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UpdateInstallCoordinator } from './update-install-coordinator'
import {
  createSignedMacUpdateFixture,
  coreAppRoot
} from '../../../../../resources/scripts/fixtures/macos-update-fixture'
import {
  UPDATE_HANDOFF_SCHEMA_VERSION,
  UpdateRecoveryStore,
  type UpdateHandoffPlan
} from './update-recovery-store'

const temporaryRoots: string[] = []

type Lifecycle = {
  attemptId: string
  phase: string
  revision: number
  taskId: string
  targetVersion: string
  [key: string]: unknown
}

function lifecycle(phase: string, overrides: Partial<Lifecycle> = {}): Lifecycle {
  return {
    attemptId: 'attempt-1',
    phase,
    revision: 1,
    taskId: 'task-1',
    targetVersion: '2.4.10',
    ...overrides
  }
}

function createRepository(initial: Lifecycle) {
  let current = initial
  return {
    get current() {
      return current
    },
    getActive: vi.fn(async () => current),
    getById: vi.fn(async () => current),
    transition: vi.fn(async (input: { to: string; patch?: Record<string, unknown> }) => {
      current = {
        ...current,
        ...input.patch,
        phase: input.to,
        revision: current.revision + 1
      }
      return current
    })
  }
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'tuff-install-coordinator-'))
  temporaryRoots.push(root)
  return root
}

function createPlan(
  store: UpdateRecoveryStore,
  overrides: Partial<UpdateHandoffPlan> = {}
): UpdateHandoffPlan {
  const paths = store.createAttemptPaths('attempt-1')
  return {
    schemaVersion: UPDATE_HANDOFF_SCHEMA_VERSION,
    attemptId: 'attempt-1',
    token: 'a'.repeat(32),
    platform: 'linux',
    parentPid: 1,
    currentVersion: '2.4.9',
    targetVersion: '2.4.10',
    taskId: 'task-1',
    packagePath: path.join(store.recoveryRoot, 'packages', 'tuff.AppImage'),
    packageSha256: 'b'.repeat(64),
    createdAt: Date.now(),
    healthTimeoutMs: 1_000,
    ackPath: paths.ackPath,
    markerPath: paths.markerPath,
    handoff: { command: '/bin/true', args: [], waitForExit: false },
    recovery: null,
    cleanupPaths: [],
    previousVersion: null,
    recoveryAvailable: false,
    ...overrides
  }
}

function createCoordinator(
  root: string,
  repository: ReturnType<typeof createRepository>,
  options: {
    currentVersion?: string
    installOnNormalQuit?: boolean
    platform?: NodeJS.Platform
    executablePath?: string
    packagePath?: string
    packageSha256?: string
    buildVerificationStatus?: {
      isVerified: boolean
      isOfficialBuild: boolean
      verificationFailed: boolean
      hasOfficialKey: boolean
    }
  } = {}
) {
  const requestQuit = vi.fn()
  const spawnProcess = vi.fn(() => ({ once: vi.fn(), unref: vi.fn() }))
  const packagePath = options.packagePath ?? path.join(root, 'packages', 'tuff.AppImage')
  const coordinator = new UpdateInstallCoordinator({
    repository: repository as never,
    storageRoot: root,
    currentVersion: options.currentVersion ?? '2.4.10',
    platform: options.platform ?? 'linux',
    resourcesPath: path.join(coreAppRoot, 'resources'),
    appPath: coreAppRoot,
    executablePath: options.executablePath ?? '/unused/tuff',
    getInstallOnNormalQuit: () => options.installOnNormalQuit ?? true,
    getBuildVerificationStatus: () =>
      options.buildVerificationStatus ?? {
        isVerified: true,
        isOfficialBuild: true,
        verificationFailed: false,
        hasOfficialKey: true
      },
    prepareInstallPackage: async () => ({
      taskId: 'task-1',
      filePath: packagePath,
      destination: path.dirname(packagePath),
      filename: path.basename(packagePath),
      sha256: options.packageSha256 ?? 'b'.repeat(64),
      signatureUrl: 'https://example.test/tuff.sig'
    }),
    requestQuit,
    spawnProcess: spawnProcess as never,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  })
  return { coordinator, packagePath, requestQuit, spawnProcess }
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('UpdateInstallCoordinator', () => {
  it.runIf(process.platform === 'darwin').each([false, true])(
    'revalidates signed bytes before quitting (tampered=%s)',
    async (tampered) => {
      const root = await createRoot()
      const fixture = await createSignedMacUpdateFixture(root)
      const repository = createRepository(
        lifecycle('preparing', {
          rollbackCompatible: false,
          rollbackFromVersion: null
        })
      )
      const { coordinator, requestQuit } = createCoordinator(
        path.dirname(fixture.appBundlePath),
        repository,
        {
          platform: 'darwin',
          currentVersion: '2.4.9',
          packagePath: fixture.packagePath,
          packageSha256: fixture.packageSha256,
          executablePath: path.join(fixture.appBundlePath, 'Contents', 'MacOS', 'fixture')
        }
      )
      await expect(coordinator.scheduleInstallNow('task-1')).rejects.toThrow('No verified update')
      expect(requestQuit).not.toHaveBeenCalled()
      await coordinator.prepareDownloadedUpdate(repository.current as never, {
        taskId: 'task-1',
        filePath: fixture.packagePath,
        sha256: fixture.packageSha256,
        destination: root,
        filename: 'Tuff.app.zip',
        signatureUrl: 'https://example.test/Tuff.app.zip.sig'
      })
      await repository.transition({ to: 'ready' })
      if (tampered) {
        const preparedPayload = path.join(
          root,
          '.tuff-update-attempt-1',
          'prepared.app',
          'Contents',
          'Resources',
          'payload.txt'
        )
        await writeFile(preparedPayload, 'tampered after ready')
        await expect(coordinator.scheduleInstallNow('task-1')).rejects.toThrow()
        expect(repository.current).toMatchObject({
          phase: 'failed',
          error: { code: 'UPDATE_INSTALL_PREFLIGHT_FAILED' }
        })
        expect(requestQuit).not.toHaveBeenCalled()
      } else {
        await expect(coordinator.scheduleInstallNow('task-1')).resolves.toMatchObject({
          phase: 'handoff-started'
        })
        expect(requestQuit).toHaveBeenCalledOnce()
        const store = new UpdateRecoveryStore(path.dirname(fixture.appBundlePath))
        const plan = await store.readPlan('attempt-1')
        expect(plan?.macosTransaction).toEqual({
          appBundlePath: fixture.appBundlePath,
          stageRoot: path.join(path.dirname(fixture.appBundlePath), '.tuff-update-attempt-1')
        })
        expect(
          await readFile(
            path.join(
              plan!.macosTransaction!.stageRoot,
              'prepared.app',
              'Contents',
              'Resources',
              'payload.txt'
            ),
            'utf8'
          )
        ).toBe('payload:2.4.10')
        expect(
          await readFile(
            path.join(fixture.appBundlePath, 'Contents', 'Resources', 'payload.txt'),
            'utf8'
          )
        ).toBe('payload:2.4.9')
      }
    }
  )

  it('never schedules a preparing attempt on normal quit', async () => {
    const root = await createRoot()
    const repository = createRepository(lifecycle('preparing', { rollbackCompatible: true }))
    const { coordinator, requestQuit, spawnProcess } = createCoordinator(root, repository)
    const intent = { kind: 'user-normal' as const, reason: 'quit', setAt: 1 }
    await coordinator.handleBeforeQuit(intent)
    coordinator.handleWillQuit(intent)
    expect(repository.current.phase).toBe('preparing')
    expect(requestQuit).not.toHaveBeenCalled()
    expect(spawnProcess).not.toHaveBeenCalled()
  })
  it('allows explicit install now for an incompatible matching ready task', async () => {
    const root = await createRoot()
    const repository = createRepository(lifecycle('ready', { rollbackCompatible: false }))
    const { coordinator, packagePath, requestQuit } = createCoordinator(root, repository)
    await mkdir(path.dirname(packagePath), { recursive: true })
    await writeFile(packagePath, 'verified package')

    await expect(coordinator.scheduleInstallNow('other-task')).rejects.toThrow('does not match')
    await expect(coordinator.scheduleInstallNow('task-1')).resolves.toMatchObject({
      phase: 'handoff-started',
      installMode: 'install-now'
    })
    expect(requestQuit).toHaveBeenCalledOnce()
  })

  it('keeps a macOS update ready when the current build cannot use silent install', async () => {
    const root = await createRoot()
    const repository = createRepository(lifecycle('ready'))
    const { coordinator, requestQuit } = createCoordinator(root, repository, {
      platform: 'darwin',
      executablePath: '/Applications/Tuff.app/Contents/MacOS/Tuff',
      buildVerificationStatus: {
        isVerified: true,
        isOfficialBuild: false,
        verificationFailed: false,
        hasOfficialKey: true
      }
    })

    await expect(coordinator.scheduleInstallNow('task-1')).rejects.toMatchObject({
      code: 'MAC_UPDATE_BUILD_UNTRUSTED'
    })
    expect(repository.current.phase).toBe('ready')
    expect(requestQuit).not.toHaveBeenCalled()
  })

  it('schedules a compatible ready update on a user normal quit', async () => {
    const root = await createRoot()
    const repository = createRepository(
      lifecycle('ready', { rollbackCompatible: true, rollbackFromVersion: '2.4.9' })
    )
    const { coordinator, packagePath } = createCoordinator(root, repository, {
      currentVersion: '2.4.9',
      installOnNormalQuit: true
    })
    await mkdir(path.dirname(packagePath), { recursive: true })
    await writeFile(packagePath, 'verified package')

    await coordinator.handleBeforeQuit({ kind: 'user-normal', reason: 'quit', setAt: 1 })

    expect(repository.current).toMatchObject({
      phase: 'handoff-started',
      installMode: 'normal-quit'
    })
  })

  it('does not schedule a normal-quit handoff when the lifecycle is incompatible', async () => {
    const root = await createRoot()
    const repository = createRepository(
      lifecycle('ready', { rollbackCompatible: false, rollbackFromVersion: '2.4.9' })
    )
    const { coordinator } = createCoordinator(root, repository, {
      currentVersion: '2.4.9',
      installOnNormalQuit: true
    })

    await coordinator.handleBeforeQuit({ kind: 'user-normal', reason: 'quit', setAt: 1 })

    expect(repository.current.phase).toBe('ready')
  })

  it('does not schedule a normal-quit handoff for a disallowed quit intent', async () => {
    const root = await createRoot()
    const repository = createRepository(lifecycle('ready'))
    const { coordinator } = createCoordinator(root, repository, { installOnNormalQuit: true })

    await coordinator.handleBeforeQuit({ kind: 'system-shutdown', reason: 'shutdown', setAt: 1 })

    expect(repository.current.phase).toBe('ready')
  })

  it('prepares and starts one helper even when BEFORE_APP_QUIT and WILL_QUIT repeat', async () => {
    const root = await createRoot()
    const repository = createRepository(
      lifecycle('install-scheduled', { installMode: 'install-now' })
    )
    const { coordinator, packagePath, spawnProcess } = createCoordinator(root, repository)
    await mkdir(path.dirname(packagePath), { recursive: true })
    await writeFile(packagePath, 'verified package')
    const intent = { kind: 'update-now' as const, reason: 'install', setAt: 1 }

    await coordinator.handleBeforeQuit(intent)
    await coordinator.handleBeforeQuit(intent)
    coordinator.handleWillQuit(intent)
    coordinator.handleWillQuit(intent)

    expect(repository.current.phase).toBe('handoff-started')
    expect(spawnProcess).toHaveBeenCalledOnce()
  })

  it('confirms the target version once, promotes its package, and writes a matching health ack', async () => {
    const root = await createRoot()
    const store = new UpdateRecoveryStore(root)
    await store.initialize()
    const plan = createPlan(store)
    await mkdir(path.dirname(plan.packagePath), { recursive: true })
    await writeFile(plan.packagePath, 'verified package')
    await store.writePlan(plan)
    const repository = createRepository(lifecycle('handoff-started'))
    const { coordinator } = createCoordinator(root, repository)

    await coordinator.initialize()
    await coordinator.confirmStartupHealth()
    const revisionAfterHealth = repository.current.revision
    await coordinator.confirmStartupHealth()

    expect(repository.current.phase).toBe('healthy')
    expect(repository.current.revision).toBe(revisionAfterHealth)
    expect(JSON.parse(await readFile(plan.ackPath, 'utf8'))).toMatchObject({
      attemptId: 'attempt-1',
      token: plan.token,
      version: '2.4.10',
      status: 'healthy'
    })
    expect(await store.readPreviousAsset()).toMatchObject({ version: '2.4.10' })
  })

  it('refuses to acknowledge health when startup runs a version other than the plan target', async () => {
    const root = await createRoot()
    const store = new UpdateRecoveryStore(root)
    await store.initialize()
    const plan = createPlan(store)
    await mkdir(path.dirname(plan.packagePath), { recursive: true })
    await writeFile(plan.packagePath, 'verified package')
    await store.writePlan(plan)
    const repository = createRepository(lifecycle('handoff-started'))
    const { coordinator } = createCoordinator(root, repository, { currentVersion: '2.4.8' })

    await coordinator.initialize()

    expect(repository.current.phase).not.toBe('healthy')
    await expect(readFile(plan.ackPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('marks a previous-version restart as recovered when a matching recovery marker exists', async () => {
    const root = await createRoot()
    const store = new UpdateRecoveryStore(root)
    await store.initialize()
    const plan = createPlan(store, { previousVersion: '2.4.9', recoveryAvailable: true })
    await mkdir(path.dirname(plan.packagePath), { recursive: true })
    await writeFile(plan.packagePath, 'verified package')
    await store.writePlan(plan)
    await writeFile(
      plan.markerPath,
      JSON.stringify({
        schemaVersion: UPDATE_HANDOFF_SCHEMA_VERSION,
        attemptId: plan.attemptId,
        token: plan.token,
        status: 'recovery-started',
        recoveryAttempted: true,
        reason: 'health timeout',
        updatedAt: 1
      })
    )
    const repository = createRepository(lifecycle('handoff-started'))
    const { coordinator } = createCoordinator(root, repository, { currentVersion: '2.4.9' })

    await coordinator.initialize()

    expect(repository.current.phase).toBe('recovered')
  })

  it('defers reconciliation and requests quit when update handoff is still in progress', async () => {
    const root = await createRoot()
    const store = new UpdateRecoveryStore(root)
    await store.initialize()
    const plan = createPlan(store)
    await mkdir(path.dirname(plan.packagePath), { recursive: true })
    await writeFile(plan.packagePath, 'verified package')
    await store.writePlan(plan)
    await store.writeLock(plan.attemptId, {
      schemaVersion: UPDATE_HANDOFF_SCHEMA_VERSION,
      attemptId: plan.attemptId,
      token: plan.token,
      helperPid: process.pid,
      startedAt: Date.now()
    })

    const repository = createRepository(lifecycle('handoff-started'))
    const { coordinator, requestQuit } = createCoordinator(root, repository, {
      currentVersion: '2.4.9'
    })

    await coordinator.initialize()

    expect(requestQuit).toHaveBeenCalledOnce()
    expect(repository.current.phase).toBe('handoff-started')
  })
})
