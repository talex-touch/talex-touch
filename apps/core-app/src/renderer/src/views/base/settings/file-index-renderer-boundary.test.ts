import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const dashboardSource = readFileSync(new URL('../LingPan.vue', import.meta.url), 'utf8')
const dashboardMainSource = readFileSync(
  new URL('../../../../../main/modules/system/tuff-dashboard.ts', import.meta.url),
  'utf8'
)

describe('file index renderer public boundary source contract', () => {
  it('renders only safe File Index dashboard names and error codes', () => {
    expect(dashboardSource).toContain('snapshot.indexing.watchedPathNames')
    expect(dashboardSource).toContain('entry.fileName')
    expect(dashboardSource).toContain('entry.errorCode')
    expect(dashboardSource).toContain('worker.errorCode')
    expect(dashboardSource).toContain('task.errorCode')
    expect(dashboardSource).not.toContain('entry.lastError')
    expect(dashboardSource).not.toContain('worker.lastError')
    expect(dashboardSource).not.toContain('task.error)')
    expect(dashboardSource).not.toContain('response?.error')
    expect(dashboardSource).not.toContain('err instanceof Error')
  })

  it('applies the File Index dashboard projector before transport return', () => {
    expect(dashboardMainSource).toContain('projectFileIndexDashboardFileName(entry.path)')
    expect(dashboardMainSource).toContain('projectFileIndexDashboardErrorCode(entry.lastError)')
    expect(dashboardMainSource).toContain('projectFileIndexDashboardWorkerSnapshot(rawSnapshot)')
    expect(dashboardMainSource).toContain("errorCode: 'TUFF_DASHBOARD_FAILED'")
  })
})
