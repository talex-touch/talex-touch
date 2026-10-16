import { describe, expect, it } from 'vitest'
import { DEMO_ACTIVATION_IDLE_TIMEOUT_MS, queueDemoActivation, shouldActivateDemo } from './demo-lazy'

describe('demo activation', () => {
  it('activates demos that are not running yet', () => {
    expect(shouldActivateDemo({ demo: 'TabsPlacementHeaderSlotDemo', isActive: false })).toBe(true)
  })

  it('does not reactivate active or missing demos', () => {
    expect(shouldActivateDemo({ demo: 'TabsPlacementHeaderSlotDemo', isActive: true })).toBe(false)
    expect(shouldActivateDemo({ demo: '', isActive: false })).toBe(false)
  })

  it('starts queued demos one per idle slot, in mount order, without waiting to be scrolled to', () => {
    const idleCallbacks: Array<() => void> = []
    const scheduler = {
      requestIdleCallback: (callback: () => void, options?: { timeout: number }) => {
        expect(options).toEqual({ timeout: DEMO_ACTIVATION_IDLE_TIMEOUT_MS })
        return idleCallbacks.push(callback)
      },
      setTimeout: () => {
        throw new Error('setTimeout is only the fallback')
      },
    }
    const started: string[] = []

    queueDemoActivation(() => started.push('first'), scheduler)
    const cancelSecond = queueDemoActivation(() => started.push('second'), scheduler)
    queueDemoActivation(() => started.push('third'), scheduler)
    cancelSecond()

    idleCallbacks.shift()!()
    expect(started).toEqual(['first'])
    while (idleCallbacks.length)
      idleCallbacks.shift()!()

    expect(started).toEqual(['first', 'third'])
  })
})
