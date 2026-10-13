import type { ClipboardCaptureSource } from '@talex-touch/utils/transport/events/types'
import { describe, expect, it } from 'vitest'
import { ClipboardFreshnessStore } from './clipboard-capture-freshness'
import { createClipboardFreshnessState } from './clipboard-freshness'

describe('clipboard-capture-freshness file authorization evidence', () => {
  const content = JSON.stringify(['/captured/截图.png'])

  it.each<{ source: ClipboardCaptureSource; authorized: boolean }>([
    { source: 'native-watch', authorized: true },
    { source: 'background-poll', authorized: true },
    { source: 'visible-poll', authorized: true },
    { source: 'corebox-show-baseline', authorized: true },
    { source: 'startup-bootstrap', authorized: false },
    { source: 'manual-write', authorized: false },
    { source: 'history-apply', authorized: false }
  ])('admits file proof only for genuine capture source $source', ({ source, authorized }) => {
    const store = new ClipboardFreshnessStore()
    store.remember(
      { id: 41, type: 'files', content },
      createClipboardFreshnessState({
        source,
        observedAt: 100,
        previousScanAt: 90
      })
    )
    // This output is the preview resolver's security evidence, not capture_source DB metadata.
    expect(store.getCapturedFilesContent(41)).toBe(authorized ? content : undefined)
  })

  it.each(['text', 'image'] as const)(
    'cannot turn a captured %s item into file proof by later mutating the caller object',
    (type) => {
      const store = new ClipboardFreshnessStore()
      const item = { id: 41, type: type as string, content }
      store.remember(
        item,
        createClipboardFreshnessState({
          source: 'native-watch',
          observedAt: 100,
          previousScanAt: null
        })
      )
      item.type = 'files'
      expect(store.getCapturedFilesContent(41)).toBeUndefined()
    }
  )

  it('revokes previous file proof when the same history identity is replaced by an applied item', () => {
    const store = new ClipboardFreshnessStore()
    store.remember(
      { id: 41, type: 'files', content },
      createClipboardFreshnessState({
        source: 'native-watch',
        observedAt: 100,
        previousScanAt: null
      })
    )
    store.remember(
      { id: 41, type: 'files', content },
      createClipboardFreshnessState({
        source: 'history-apply',
        observedAt: 200,
        previousScanAt: null
      })
    )
    expect(store.getCapturedFilesContent(41)).toBeUndefined()
  })

  it.each(['delete', 'clear'] as const)('revokes immutable capture evidence on %s', (operation) => {
    const store = new ClipboardFreshnessStore()
    const item = { id: 41, type: 'files', content }
    store.remember(
      item,
      createClipboardFreshnessState({
        source: 'native-watch',
        observedAt: 100,
        previousScanAt: null
      })
    )
    item.content = JSON.stringify(['/uncaptured/secret.png'])
    expect(store.getCapturedFilesContent(41)).toBe(content)
    if (operation === 'delete') store.delete(41)
    else store.clear()
    expect(store.getCapturedFilesContent(41)).toBeUndefined()
  })
})
