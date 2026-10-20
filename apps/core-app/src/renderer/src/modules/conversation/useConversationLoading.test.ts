import { describe, expect, it } from 'vitest'
import {
  isConversationLoading,
  resetConversationLoading,
  setConversationLoading,
  useConversationLoading
} from './useConversationLoading'

describe('useConversationLoading', () => {
  it('tracks loading state for conversations reactively', () => {
    resetConversationLoading()
    expect(isConversationLoading('conv-1')).toBe(false)

    setConversationLoading('conv-1', true)
    expect(isConversationLoading('conv-1')).toBe(true)
    expect(isConversationLoading('conv-2')).toBe(false)

    setConversationLoading('conv-2', true)
    expect(isConversationLoading('conv-1')).toBe(true)
    expect(isConversationLoading('conv-2')).toBe(true)

    setConversationLoading('conv-1', false)
    expect(isConversationLoading('conv-1')).toBe(false)
    expect(isConversationLoading('conv-2')).toBe(true)

    resetConversationLoading()
    expect(isConversationLoading('conv-2')).toBe(false)
  })

  it('exposes reactive helpers via composable call', () => {
    resetConversationLoading()
    const { isConversationLoading: check, setConversationLoading: update } =
      useConversationLoading()

    expect(check('c-abc')).toBe(false)
    update('c-abc', true)
    expect(check('c-abc')).toBe(true)
    update('c-abc', false)
    expect(check('c-abc')).toBe(false)
  })
})
