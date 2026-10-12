// @vitest-environment jsdom
import type { TuffItem } from '@talex-touch/utils'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextPreview from './TextPreview.vue'

const host = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@talex-touch/utils/transport', () => ({ useTuffTransport: () => ({ send: host.read }) }))
vi.mock('@talex-touch/utils/env', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, isElectronRenderer: () => true }
})
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

let wrapper: VueWrapper | undefined
const visited: string[] = []
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
beforeEach(() => {
  visited.length = 0
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value(this: HTMLElement) {
      visited.push(this.dataset.line ?? 'highlight')
    }
  })
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  host.read.mockReset()
  vi.unstubAllGlobals()
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})

function textItem(lineNumber: number): TuffItem {
  return {
    id: '/policy.txt',
    kind: 'file',
    source: { id: 'files', type: 'file', name: 'Files' },
    render: { mode: 'default', basic: { title: 'policy.txt' } },
    meta: {
      file: { path: '/policy.txt', size: 100 },
      deepMatch: { kind: 'code', lineNumber, matchTerm: 'pets' }
    }
  } as TuffItem
}

describe('TextPreview matching original file content', () => {
  it('renders markup and entity bytes literally rather than creating elements while highlighting the query', async () => {
    const text = '<img src=x onerror=alert(1)> &amp; 🐾 pets\nsecond line'
    host.read.mockResolvedValue(text)
    wrapper = mount(TextPreview, {
      props: { item: textItem(1), resourceUrl: 'tfile:///policy.txt' }
    })
    await flushPromises()
    const pre = wrapper.get('pre.highlighted-content')
    expect(pre.element.textContent).toBe(text)
    expect(pre.findAll('mark').map((mark) => mark.text())).toEqual(['pets'])
    expect(pre.find('img').exists()).toBe(false)
    expect(pre.get('[data-line="1"]').classes()).toContain('target-line')
  })

  it('navigates when an async read finishes and again when only the target line changes', async () => {
    const ready = Promise.withResolvers<string>()
    host.read.mockReturnValue(ready.promise)
    wrapper = mount(TextPreview, {
      props: { item: textItem(2), resourceUrl: 'tfile:///policy.txt' }
    })
    expect(visited).toEqual([])
    ready.resolve(Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n'))
    await flushPromises()
    expect(visited.at(-1)).toBe('2')
    expect(wrapper.get('[data-line="2"]').classes()).toContain('target-line')
    await wrapper.setProps({ item: textItem(50) })
    await flushPromises()
    expect(visited.at(-1)).toBe('50')
    expect(wrapper.get('[data-line="50"]').classes()).toContain('target-line')
    expect(wrapper.get('[data-line="2"]').classes()).not.toContain('target-line')
    expect(wrapper.get('pre').element.textContent).toBe(
      Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n')
    )
  })
})
