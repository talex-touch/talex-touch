import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { TxLearningCurve } from '../src/learning-curve'

const sampleRuns = [
  {
    name: 'SAC',
    seeds: [
      [[0, 0], [1000, 50], [2000, 100]],
      [[0, 0], [1000, 60], [2000, 110]],
    ],
  },
]

describe('txLearningCurve', () => {
  it('renders learning curve with band and smoothed lines', async () => {
    const wrapper = mount(TxLearningCurve, {
      props: {
        runs: sampleRuns,
        width: 600,
        height: 300,
        xAxisName: '环境步数',
        yAxisName: '回合回报',
      } as never,
    })
    await nextTick()

    // Verify axis names are rendered
    const axisNames = wrapper.findAll('text.tx-axis__name')
    expect(axisNames.length).toBe(2)

    // Verify y axis name has expected position with default nameGap 56 (plot.x is 72, so 72 - 56 = 16)
    const yAxis = wrapper.find('.tx-axis--left')
    expect(yAxis.exists()).toBe(true)
    const yAxisName = yAxis.find('text.tx-axis__name')
    expect(yAxisName.exists()).toBe(true)
    expect(yAxisName.text()).toBe('回合回报')
    expect(yAxisName.attributes('x')).toBe('16')
  })

  it('respects custom yAxisNameGap when provided', async () => {
    const wrapper = mount(TxLearningCurve, {
      props: {
        runs: sampleRuns,
        width: 600,
        height: 300,
        yAxisName: '损失',
        yAxisNameGap: 60,
      } as never,
    })
    await nextTick()

    const yAxis = wrapper.find('.tx-axis--left')
    const yAxisName = yAxis.find('text.tx-axis__name')
    expect(yAxisName.attributes('x')).toBe('12') // 72 - 60 = 12
  })
})
