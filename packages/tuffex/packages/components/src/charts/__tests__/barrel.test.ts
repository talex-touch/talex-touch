import { describe, expect, it } from 'vitest'
import * as charts from '../index'

describe('charts barrel', () => {
  it('exports the label defaults and helpers the docs name', () => {
    for (const name of [
      'HEATMAP_DEFAULT_LABELS',
      'heatmapSelection',
      'MAP_DEFAULT_LABELS',
      'offsetSankeyLayout',
      'SANKEY_DEFAULT_LABELS',
    ])
      expect(charts, name).toHaveProperty(name)
  })
})
