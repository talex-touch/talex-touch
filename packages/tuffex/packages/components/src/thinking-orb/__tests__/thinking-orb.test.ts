import type { Ink } from '../src/engine/ink'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inkStyle, monoInk } from '../src/engine/ink'
import { MODE_DRAWS } from '../src/engine/registry'
import { ORB_PALETTES, ORB_STATE_PALETTES, resolvePalette } from '../src/palettes'
import { resolvePreset, STATE_TO_MODE } from '../src/presets'
import TxThinkingOrb from '../src/TxThinkingOrb.vue'
import { ORB_STATES } from '../src/types'

function channels(style: string): number[] {
  return style.slice('rgba('.length, -1).split(',').slice(0, 3).map(Number)
}

function sum(rgb: number[]): number {
  return rgb.reduce((a, b) => a + b, 0)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('engine contract', () => {
  it('maps every state to a mode with a painter', () => {
    for (const state of ORB_STATES) {
      const mode = STATE_TO_MODE[state]
      expect(mode, state).toBeTruthy()
      expect(typeof MODE_DRAWS[mode], mode).toBe('function')
    }
  })

  it('resolves presets for both tuned sizes', () => {
    for (const state of ORB_STATES) {
      for (const size of [20, 64] as const) {
        const resolved = resolvePreset(state, size)
        expect(resolved.speed).toBeGreaterThan(0)
        expect(resolved.opts).toBeTruthy()
      }
    }
  })
})

describe('palettes', () => {
  it('gives every state a palette of three hex stops', () => {
    for (const state of ORB_STATES) {
      const stops = ORB_PALETTES[ORB_STATE_PALETTES[state]]
      expect(stops, state).toHaveLength(3)
      for (const stop of stops)
        expect(stop, state).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('resolves a name, custom stops, and falls back to the state palette', () => {
    const custom = ['red', 'blue']
    expect(resolvePalette(undefined, 'working')).toBe(ORB_PALETTES.amber)
    expect(resolvePalette('forest', 'working')).toBe(ORB_PALETTES.forest)
    expect(resolvePalette(custom, 'working')).toBe(custom)
    // Unknown names — Object.prototype keys included — are not palettes.
    expect(resolvePalette('nope' as never, 'searching')).toBe(ORB_PALETTES.glacier)
    expect(resolvePalette('toString' as never, 'searching')).toBe(ORB_PALETTES.glacier)
  })
})

describe('ink', () => {
  it('keeps the grey ink identical to upstream', () => {
    for (const dark of [true, false]) {
      for (const white of [-0.2, 0, 0.37, 1, 1.4]) {
        const w = Math.min(1, Math.max(0, white))
        const g = Math.round((dark ? 1 - w : w) * 255)
        expect(inkStyle(monoInk(dark), white, 7, 0.5)).toBe(`rgba(${g},${g},${g},0.5)`)
      }
    }
  })

  it('lays the ramp left to right on both themes', () => {
    for (const dark of [true, false]) {
      const ink: Ink = { dark, ramp: [[255, 0, 0], [0, 0, 255]], size: 20 }
      const [leftR, , leftB] = channels(inkStyle(ink, 0.3, 0, 1))
      const [rightR, , rightB] = channels(inkStyle(ink, 0.3, 20, 1))
      expect(leftR, `dark=${dark}`).toBeGreaterThan(leftB!)
      expect(rightB, `dark=${dark}`).toBeGreaterThan(rightR!)
    }
  })

  it('keeps depth: near marks stand further off the substrate than far ones', () => {
    const ramp = [[233, 161, 59], [225, 79, 98]] as const
    const dark: Ink = { dark: true, ramp, size: 20 }
    const light: Ink = { dark: false, ramp, size: 20 }
    expect(sum(channels(inkStyle(dark, 0, 10, 1)))).toBeGreaterThan(sum(channels(inkStyle(dark, 0.7, 10, 1))))
    expect(sum(channels(inkStyle(light, 0, 10, 1)))).toBeLessThan(sum(channels(inkStyle(light, 0.7, 10, 1))))
    // The nearest marks on a dark substrate stay close to white.
    expect(Math.min(...channels(inkStyle(dark, 0, 10, 1)))).toBeGreaterThan(200)
  })
})

describe('txThinkingOrb', () => {
  it('renders a labelled canvas', () => {
    const wrapper = mount(TxThinkingOrb, { props: { state: 'breathing' } })
    const canvas = wrapper.find('canvas')
    expect(canvas.exists()).toBe(true)
    expect(canvas.attributes('role')).toBe('img')
    expect(canvas.attributes('aria-label')).toBe('Thinking…')
  })

  it('rolls a random state once per mount', () => {
    // 0.999… lands on the last state; the roll happens at setup time.
    vi.spyOn(Math, 'random').mockReturnValue(0.9999)
    const wrapper = mount(TxThinkingOrb)
    expect(wrapper.find('canvas').attributes('aria-label')).toBe('Shaping…')
  })

  it('prefers an explicit label over the state default', () => {
    const wrapper = mount(TxThinkingOrb, { props: { state: 'working', label: '思考中' } })
    expect(wrapper.find('canvas').attributes('aria-label')).toBe('思考中')
  })

  it('sizes the canvas by displaySize while keeping preset geometry', () => {
    const wrapper = mount(TxThinkingOrb, { props: { size: 20, displaySize: 14 } })
    const style = wrapper.find('canvas').attributes('style') ?? ''
    expect(style).toContain('width: 14px')
    expect(style).toContain('height: 14px')
  })

  it('restarts for a new palette but not for an equal fresh array', async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const wrapper = mount(TxThinkingOrb, { props: { state: 'working', variant: 'gradient', palette: ['red', 'blue'] } })
    const mounted = getContext.mock.calls.length

    await wrapper.setProps({ palette: ['red', 'blue'] })
    expect(getContext.mock.calls.length).toBe(mounted)

    await wrapper.setProps({ palette: ['red', 'green'] })
    expect(getContext.mock.calls.length).toBe(mounted + 1)

    await wrapper.setProps({ variant: 'mono' })
    expect(getContext.mock.calls.length).toBe(mounted + 2)
  })
})
