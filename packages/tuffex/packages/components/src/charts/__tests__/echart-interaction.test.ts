import type { EChartsOption } from 'echarts'
import { describe, expect, it } from 'vitest'
import {
  createWheelZoomStepper,
  isZoomedWindow,
  panState,
  prepareInteraction,
  readDataZoomEvent,
} from '../src/echart/src/core/interaction'

/** Reads the dataZoom list off a prepared option, whatever shape the option gave it. */
function dataZooms(option: EChartsOption): Array<Record<string, unknown>> {
  const value = option.dataZoom
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value]
  return list.map(entry => ({ ...entry }))
}

describe('panState', () => {
  it('offers the grab only once the window is narrowed', () => {
    expect(panState(true)).toEqual({ cursorGrab: 'grab', cursorGrabbing: 'grabbing', preventDefaultMouseMove: true })
    expect(panState(false)).toEqual({ cursorGrab: 'crosshair', cursorGrabbing: 'crosshair', preventDefaultMouseMove: false })
  })
})

describe('isZoomedWindow', () => {
  it('is false for the full range and for float noise at its ends', () => {
    expect(isZoomedWindow(0, 100)).toBe(false)
    expect(isZoomedWindow(undefined, undefined)).toBe(false)
    expect(isZoomedWindow(1e-9, 100 - 1e-9)).toBe(false)
  })

  it('is true as soon as either end is narrowed', () => {
    expect(isZoomedWindow(10, 100)).toBe(true)
    expect(isZoomedWindow(0, 99.9)).toBe(true)
    expect(isZoomedWindow(undefined, 50)).toBe(true)
  })
})

describe('prepareInteraction', () => {
  it('leaves an option without roaming parts untouched', () => {
    const option: EChartsOption = { series: [{ type: 'line', data: [1, 2] }] }
    const { option: prepared, interaction } = prepareInteraction(option)
    expect(prepared).toBe(option)
    expect(interaction).toEqual({ zoomIds: [], managedZoomIds: [], zoomedIds: [], wheelZoom: false, treemaps: [] })
  })

  it('gives an inside dataZoom an id and the read cursor at the full range', () => {
    const { option, interaction } = prepareInteraction({ dataZoom: [{ type: 'inside', xAxisIndex: 0 }] })
    expect(dataZooms(option)).toEqual([
      { type: 'inside', xAxisIndex: 0, id: 'tx-dz-0', cursorGrab: 'crosshair', cursorGrabbing: 'crosshair', preventDefaultMouseMove: false },
    ])
    expect(interaction).toMatchObject({ zoomIds: ['tx-dz-0'], managedZoomIds: ['tx-dz-0'], zoomedIds: [], wheelZoom: true })
  })

  it('keeps the id the option chose, and offers the grab when it opens narrowed', () => {
    const { option, interaction } = prepareInteraction({ dataZoom: [{ type: 'inside', id: 'range', start: 20, end: 80 }] })
    expect(dataZooms(option)[0]).toMatchObject({ id: 'range', cursorGrab: 'grab', cursorGrabbing: 'grabbing', preventDefaultMouseMove: true })
    expect(interaction.zoomedIds).toEqual(['range'])
  })

  it('treats a window given in data values as narrowed', () => {
    const { interaction } = prepareInteraction({ dataZoom: [{ type: 'inside', startValue: 3 }] })
    expect(interaction.zoomedIds).toEqual(['tx-dz-0'])
  })

  it('shares one pan state between the dataZooms of a grid', () => {
    const { option } = prepareInteraction({ dataZoom: [{ type: 'inside', xAxisIndex: 0 }, { type: 'inside', yAxisIndex: 0, start: 40 }] })
    expect(dataZooms(option).map(entry => entry.cursorGrab)).toEqual(['grab', 'grab'])
  })

  it('skips sliders and disabled dataZooms, and keeps their place in the list', () => {
    const { option, interaction } = prepareInteraction({
      dataZoom: [{ type: 'slider' }, { type: 'inside', disabled: true }, { type: 'inside' }],
    })
    expect(interaction.zoomIds).toEqual(['tx-dz-2'])
    expect(dataZooms(option)[0]).toEqual({ type: 'slider' })
    expect(dataZooms(option)[1]).toEqual({ type: 'inside', disabled: true })
    expect(dataZooms(option)[2]).toMatchObject({ id: 'tx-dz-2' })
  })

  it('leaves a dataZoom that sets its own cursor as the option wrote it', () => {
    const { option, interaction } = prepareInteraction({ dataZoom: [{ type: 'inside', cursorGrab: 'move' }] })
    expect(dataZooms(option)[0]).toEqual({ type: 'inside', cursorGrab: 'move', id: 'tx-dz-0' })
    expect(interaction.managedZoomIds).toEqual([])
    expect(interaction.zoomIds).toEqual(['tx-dz-0'])
  })

  it('does not count a zoom-locked dataZoom as something the wheel zooms', () => {
    expect(prepareInteraction({ dataZoom: [{ type: 'inside', zoomLock: true }] }).interaction.wheelZoom).toBe(false)
  })

  it('collects treemaps that roam, and counts only zooming roams as wheel zoom', () => {
    const zoomingOn = prepareInteraction({ series: [{ type: 'line' }, { type: 'treemap', roam: true }] }).interaction
    expect(zoomingOn).toMatchObject({ treemaps: [1], wheelZoom: true })
    const moveOnly = prepareInteraction({ series: [{ type: 'treemap', roam: 'move' }] }).interaction
    expect(moveOnly).toMatchObject({ treemaps: [0], wheelZoom: false })
    const off = prepareInteraction({ series: [{ type: 'treemap', roam: false }, { type: 'treemap' }] }).interaction
    expect(off).toMatchObject({ treemaps: [], wheelZoom: false })
  })

  it('counts a zooming geo roam as wheel zoom', () => {
    expect(prepareInteraction({ geo: { roam: 'scale' } }).interaction.wheelZoom).toBe(true)
    expect(prepareInteraction({ geo: { roam: false } }).interaction.wheelZoom).toBe(false)
  })

  it('does not change the option it is given', () => {
    const entry = { type: 'inside' as const }
    const option: EChartsOption = { dataZoom: [entry] }
    prepareInteraction(option)
    expect(entry).toEqual({ type: 'inside' })
    expect(option.dataZoom).toEqual([{ type: 'inside' }])
  })

  describe('with the windows the chart reported', () => {
    const reported = [
      { id: 'tx-dz-0', type: 'inside', start: 25, end: 60, startValue: 3, endValue: 7 },
      { id: 'tx-dz-1', type: 'inside', start: 0, end: 100 },
    ]

    it('puts the narrowed window back on a dataZoom that sets none, with the grab it needs', () => {
      const { option, interaction } = prepareInteraction({
        dataZoom: [{ type: 'inside', xAxisIndex: 0 }, { type: 'inside', yAxisIndex: 0 }],
      }, reported)
      expect(dataZooms(option)[0]).toMatchObject({ id: 'tx-dz-0', start: 25, end: 60, cursorGrab: 'grab' })
      expect(dataZooms(option)[0]).not.toHaveProperty('startValue')
      // The full range is what a fresh dataZoom opens on already.
      expect(dataZooms(option)[1]).not.toHaveProperty('start')
      expect(interaction.zoomedIds).toEqual(['tx-dz-0'])
    })

    it('leaves a window the option sets itself as the option wrote it', () => {
      for (const own of [{ start: 0, end: 100 }, { end: 80 }, { startValue: 1 }]) {
        const { option } = prepareInteraction({ dataZoom: [{ type: 'inside', ...own }] }, reported)
        expect(dataZooms(option)[0]).toMatchObject(own)
        expect(dataZooms(option)[0]).not.toHaveProperty('start', 25)
      }
    })

    it('matches by id, and only inside dataZooms that are on', () => {
      const { option } = prepareInteraction({
        dataZoom: [{ type: 'inside', id: 'range' }, { type: 'slider' }, { type: 'inside', disabled: true }],
      }, [{ id: 'tx-dz-0', start: 25, end: 60 }, { id: 'tx-dz-1', start: 25, end: 60 }, { id: 'tx-dz-2', start: 25, end: 60 }])
      expect(dataZooms(option).map(entry => entry.start)).toEqual([undefined, undefined, undefined])
      const kept = prepareInteraction({ dataZoom: [{ type: 'inside', id: 'range' }] }, [{ id: 'range', start: 10, end: 20 }])
      expect(dataZooms(kept.option)[0]).toMatchObject({ id: 'range', start: 10, end: 20 })
    })

    it('ignores whatever is not a list of windows', () => {
      for (const junk of [undefined, null, 'x', [null, 3, { start: 5 }], { id: 'tx-dz-0', start: 'a', end: 'b' }]) {
        const { option } = prepareInteraction({ dataZoom: [{ type: 'inside' }] }, junk)
        expect(dataZooms(option)[0]).not.toHaveProperty('start')
      }
    })
  })
})

describe('readDataZoomEvent', () => {
  it('reads one window per batch item', () => {
    expect(readDataZoomEvent({ type: 'datazoom', batch: [{ dataZoomId: 'a', start: 10, end: 60 }, { dataZoomId: 'b', start: 0, end: 100 }] }))
      .toEqual([
        { dataZoomId: 'a', start: 10, end: 60, byValue: false },
        { dataZoomId: 'b', start: 0, end: 100, byValue: false },
      ])
  })

  it('reads a flat event, which names no dataZoom when it addressed all of them', () => {
    expect(readDataZoomEvent({ type: 'datazoom', start: 5, end: 95 })).toEqual([{ start: 5, end: 95, byValue: false }])
  })

  it('marks a window given in data values, whose percent it cannot know', () => {
    expect(readDataZoomEvent({ batch: [{ dataZoomId: 'a', startValue: 3, endValue: 9 }] }))
      .toEqual([{ dataZoomId: 'a', start: undefined, end: undefined, byValue: true }])
  })

  it('ignores whatever is not an event object', () => {
    expect(readDataZoomEvent(null)).toEqual([])
    expect(readDataZoomEvent('datazoom')).toEqual([])
    expect(readDataZoomEvent({ batch: [1, null, { start: 1 }] })).toEqual([{ start: 1, end: undefined, byValue: false }])
  })
})

describe('createWheelZoomStepper', () => {
  it('turns one mouse notch into one of ECharts\' large steps, in and out', () => {
    const step = createWheelZoomStepper()
    expect(step(-100, 0)).toBe(4)
    expect(step(100, 1000)).toBe(-4)
  })

  it('adds the small deltas of a pinch up until they make a step', () => {
    const step = createWheelZoomStepper()
    expect([step(-10, 0), step(-10, 50), step(-10, 100)]).toEqual([0, 0, 0.5])
  })

  it('drops the remainder after a pause', () => {
    const step = createWheelZoomStepper()
    expect(step(-10, 0)).toBe(0)
    expect(step(-10, 50)).toBe(0)
    expect(step(-10, 2000)).toBe(0)
    expect(step(-10, 2050)).toBe(0)
  })
})
