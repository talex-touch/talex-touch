import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TxDataTable from '../src/TxDataTable.vue'

describe('txDataTable semantic column types and smart defaults', () => {
  describe('actions column auto-sticking', () => {
    it('automatically sticks actions column to the right edge with right alignment', () => {
      const columns = [
        { key: 'title', title: 'Title', width: 200 },
        { key: 'actions', title: '操作', width: 140 },
      ]
      const data = [{ title: 'Item 1' }]
      const wrapper = mount(TxDataTable, {
        props: { columns, data, scrollX: true },
      })

      const ths = wrapper.findAll('thead th')
      const tds = wrapper.findAll('tbody td')

      expect(ths[1].classes()).toContain('is-fixed')
      expect(ths[1].classes()).toContain('is-fixed-right')
      expect(ths[1].attributes('style')).toContain('right: 0px')
      expect(ths[1].attributes('style')).toContain('text-align: right')

      expect(tds[1].classes()).toContain('is-fixed')
      expect(tds[1].classes()).toContain('is-fixed-right')
      expect(tds[1].attributes('style')).toContain('right: 0px')
      expect(tds[1].attributes('style')).toContain('text-align: right')
    })

    it('respects explicit fixed: false to disable auto-sticking on actions', () => {
      const columns = [
        { key: 'title', title: 'Title', width: 200 },
        { key: 'actions', title: '操作', fixed: false },
      ]
      const data = [{ title: 'Item 1' }]
      const wrapper = mount(TxDataTable, {
        props: { columns, data },
      })

      const ths = wrapper.findAll('thead th')
      expect(ths[1].classes()).not.toContain('is-fixed')
      expect(ths[1].classes()).not.toContain('is-fixed-right')
    })
  })

  describe('number column', () => {
    it('applies right alignment, numeric sort, and range filter', async () => {
      const columns = [
        { key: 'name', title: 'Name' },
        { key: 'count', title: 'Count', type: 'number' as const, filter: true },
      ]
      const data = [
        { name: 'A', count: 100 },
        { name: 'B', count: 50 },
        { name: 'C', count: 5 },
      ]
      const wrapper = mount(TxDataTable, {
        props: { columns, data },
      })

      const ths = wrapper.findAll('thead th')
      expect(ths[1].classes()).toContain('is-type-number')
      expect(ths[1].classes()).toContain('is-numeric')
      expect(ths[1].attributes('style')).toContain('text-align: right')

      // Numeric sort check: asc should sort 5 -> 50 -> 100 (never 100 < 50)
      const sortBtn = ths[1].find('.tx-data-table__sort-button')
      await sortBtn.trigger('click')

      const rowTexts = wrapper.findAll('tbody tr').map(r => r.findAll('td')[1].text())
      expect(rowTexts).toEqual(['5', '50', '100'])

      // Controlled numeric filter check
      await wrapper.setProps({
        filter: { count: { min: 20, max: 80 } },
      })

      const filteredRows = wrapper.findAll('tbody tr').map(r => r.findAll('td')[1].text())
      expect(filteredRows).toEqual(['50'])
    })
  })

  describe('datetime column', () => {
    it('sorts by timestamp and supports date range filter presets', async () => {
      const columns = [
        { key: 'time', title: 'Time', type: 'datetime' as const, filter: true },
      ]
      const data = [
        { time: '2026-10-10 12:00:00' },
        { time: '2026-10-12 18:00:00' },
        { time: '2026-10-01 09:00:00' },
      ]
      const wrapper = mount(TxDataTable, {
        props: { columns, data },
      })

      // Sort by date asc
      const sortBtn = wrapper.find('.tx-data-table__sort-button')
      await sortBtn.trigger('click')

      const rowDates = wrapper.findAll('tbody tr').map(r => r.find('.tx-data-table__datetime').text())
      expect(rowDates[0]).toContain('2026-10-01')
      expect(rowDates[1]).toContain('2026-10-10')
      expect(rowDates[2]).toContain('2026-10-12')
    })
  })

  describe('tag and source columns with fallback empty dash', () => {
    it('renders tag pills and source badges with — for null/empty values', async () => {
      const columns = [
        { key: 'kind', title: 'Kind', type: 'tag' as const, filter: true },
        { key: 'source', title: 'Source', type: 'source' as const },
        { key: 'emptyField', title: 'Empty' },
      ]
      const data = [
        { kind: 'Official', source: 'Netease', emptyField: null },
        { kind: 'Community', source: null, emptyField: '' },
      ]
      const wrapper = mount(TxDataTable, {
        props: { columns, data },
      })

      const rows = wrapper.findAll('tbody tr')
      // Row 1
      expect(rows[0].find('.tx-data-table__tag-pill').text()).toBe('Official')
      expect(rows[0].find('.tx-data-table__source-badge').text()).toBe('Netease')
      expect(rows[0].findAll('td')[2].text()).toBe('—')

      // Row 2
      expect(rows[1].find('.tx-data-table__tag-pill').text()).toBe('Community')
      expect(rows[1].find('.tx-data-table__source-badge').text()).toBe('—')
      expect(rows[1].findAll('td')[2].text()).toBe('—')

      // Tag filter
      await wrapper.setProps({
        filter: { kind: 'Official' },
      })
      expect(wrapper.findAll('tbody tr')).toHaveLength(1)
      expect(wrapper.find('tbody tr').find('.tx-data-table__tag-pill').text()).toBe('Official')
    })
  })
})
