import { describe, expect, it } from 'vitest'
import {
  createVelocityTracker,
  isZoomWheel,
  projectMomentum,
  responseSpring,
  rubberband,
  wheelPixels,
  wheelZoomFactor,
} from '../gesture'

describe('gesture physics', () => {
  it('resists more the further past the edge, and never reaches the pull', () => {
    const near = rubberband(10, 100)
    const far = rubberband(1000, 100)
    expect(near).toBeGreaterThan(0)
    expect(near).toBeLessThan(10)
    expect(far).toBeLessThan(100)
    expect(rubberband(-10, 100)).toBeCloseTo(-near)
    expect(rubberband(10, 0)).toBe(0)
  })

  it('projects a flick with Apple\'s exponential deceleration', () => {
    // 1000 px/s at 0.998 carries 499 px, not the textbook v²/2a.
    expect(projectMomentum(1000)).toBeCloseTo(499)
    expect(projectMomentum(-1000, 0.99)).toBeCloseTo(-99)
    expect(projectMomentum(0)).toBe(0)
  })

  it('turns response and damping ratio into a unit-mass spring', () => {
    const spring = responseSpring(0.4, 1)
    const omega = 2 * Math.PI / 0.4
    expect(spring.stiffness).toBeCloseTo(omega * omega)
    // Critical damping: c = 2√k for unit mass.
    expect(spring.damping).toBeCloseTo(2 * Math.sqrt(spring.stiffness))
    expect(responseSpring(0.4, 0.8).damping).toBeCloseTo(0.8 * spring.damping)
  })

  it('reads release velocity from the last window and drops a stopped pointer', () => {
    const tracker = createVelocityTracker(100)
    tracker.reset(0, 0)
    tracker.push(50, 25)
    tracker.push(100, 50)
    tracker.push(150, 75)
    // Over the last 100 ms: 50 px in 0.1 s.
    expect(tracker.velocity(150)[0]).toBeCloseTo(500)
    // Held still for longer than half the window before letting go.
    expect(tracker.velocity(260)).toEqual([0, 0])
  })

  it('clamps a release to the maximum speed', () => {
    const tracker = createVelocityTracker(100, 4000)
    tracker.reset(0, 0, 0)
    tracker.push(10, 0, 500)
    expect(tracker.velocity(10)[1]).toBe(4000)
  })

  it('zooms only with ⌘ or Ctrl, which is also how a pinch arrives', () => {
    expect(isZoomWheel({ ctrlKey: true, metaKey: false })).toBe(true)
    expect(isZoomWheel({ ctrlKey: false, metaKey: true })).toBe(true)
    expect(isZoomWheel({ ctrlKey: false, metaKey: false })).toBe(false)
  })

  it('normalizes wheel units and zooms symmetrically', () => {
    expect(wheelPixels({ deltaMode: 1, deltaX: 0, deltaY: 3 })).toEqual({ x: 0, y: 48 })
    expect(wheelPixels({ deltaMode: 0, deltaX: 4, deltaY: -2 })).toEqual({ x: 4, y: -2 })
    expect(wheelZoomFactor(100)).toBeCloseTo(Math.SQRT1_2)
    expect(wheelZoomFactor(-40) * wheelZoomFactor(40)).toBeCloseTo(1)
    // A runaway delta is capped at one notch.
    expect(wheelZoomFactor(5000)).toBeCloseTo(wheelZoomFactor(100))
  })
})
