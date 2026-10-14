// @vitest-environment jsdom
import { AppEvents } from '@talex-touch/utils/transport/events'
import type { VueWrapper } from '@vue/test-utils'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import UnifiedFileTag from './UnifiedFileTag.vue'
import type { IBoxOptions } from '../../../modules/box/adapter'
import type { IClipboardOptions, IClipboardItem } from '../../../modules/box/adapter/hooks/types'
import { BoxMode } from '../../../modules/box/adapter'
import { useClipboard } from '../../../modules/box/adapter/hooks/useClipboard'
import { reactive } from 'vue'

const host = vi.hoisted(() => ({ send: vi.fn() }))
const capture = vi.hoisted(() => ({ latest: null as IClipboardItem | null }))
vi.mock('~/modules/storage/app-storage', () => ({
  appSetting: { tools: { autoPaste: { enable: false, time: 5 } } }
}))
vi.mock('~/modules/box/adapter/hooks/useClipboardChannel', () => ({
  getLatestClipboard: async () => capture.latest,
  useClipboardChannel: () => () => {}
}))
vi.mock('@talex-touch/utils/transport', () => ({
  useTuffTransport: () => ({ send: host.send })
}))
vi.mock('@talex-touch/utils/env', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isElectronRenderer: () => true
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

const THUMBNAIL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG1kAAAAASUVORK5CYII='
const LARK_PATH =
  '/Users/demo/Library/Containers/com.lark.Lark/Data/Library/Application Support/Lark/Downloads/photo.png'
let wrapper: VueWrapper | null = null

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  host.send.mockReset()
  capture.latest = null
})

describe('UnifiedFileTag authorized resource rendering', () => {
  it('never renders the original image while its permission is pending, then renders only the grant', async () => {
    const permission = Promise.withResolvers<{ success: boolean; tfileUrl: string }>()
    host.send.mockImplementation(() => permission.promise)
    wrapper = mount(UnifiedFileTag, { props: { paths: [LARK_PATH], clipboardId: 41 } })
    await flushPromises()
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.get('.name').text()).toBe('photo.png')
    expect(wrapper.find('.file-icon-fallback').exists()).toBe(true)
    permission.resolve({
      success: true,
      tfileUrl: 'tfile:///canonical/photo.png?previewGrant=approved'
    })
    await flushPromises()
    expect(wrapper.get('img').attributes('src')).toBe(
      'tfile:///canonical/photo.png?previewGrant=approved'
    )
    await wrapper.get('img').trigger('error')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('.file-icon-fallback').exists()).toBe(true)
  })

  it('ignores late permission for an old selection and clears the old image synchronously', async () => {
    const oldPermission = Promise.withResolvers<{ success: boolean; tfileUrl: string }>()
    const selectedPermission = Promise.withResolvers<{ success: boolean; tfileUrl: string }>()
    const thirdPermission = Promise.withResolvers<{ success: boolean; tfileUrl: string }>()
    host.send.mockImplementation((_event, payload) =>
      payload.clipboardId === 41
        ? oldPermission.promise
        : payload.clipboardId === 42
          ? selectedPermission.promise
          : thirdPermission.promise
    )
    wrapper = mount(UnifiedFileTag, { props: { paths: [LARK_PATH], clipboardId: 41 } })
    await flushPromises()
    await wrapper.setProps({ paths: ['/captured/new.png'], clipboardId: 42 })
    await flushPromises()
    oldPermission.resolve({ success: true, tfileUrl: 'tfile:///old.png?previewGrant=old' })
    await flushPromises()
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.get('.name').text()).toBe('new.png')
    selectedPermission.resolve({ success: true, tfileUrl: 'tfile:///new.png?previewGrant=new' })
    await flushPromises()
    expect(wrapper.get('img').attributes('src')).toBe('tfile:///new.png?previewGrant=new')
    await wrapper.setProps({ paths: ['/captured/third.png'], clipboardId: 43 })
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('does not resurrect an image after its consumer unmounts', async () => {
    const permission = Promise.withResolvers<{ success: boolean; tfileUrl: string }>()
    host.send.mockImplementation(() => permission.promise)
    const container = document.createElement('div')
    document.body.append(container)
    try {
      wrapper = mount(UnifiedFileTag, {
        props: { paths: [LARK_PATH], clipboardId: 41 },
        attachTo: container
      })
      await flushPromises()
      wrapper.unmount()
      wrapper = null
      permission.resolve({ success: true, tfileUrl: 'tfile:///photo.png?previewGrant=late' })
      await flushPromises()
      expect(container.querySelector('img')).toBeNull()
      expect(container.textContent).toBe('')
    } finally {
      container.remove()
    }
  })

  it('prefers the prepared thumbnail and falls back to the file glyph if decoding fails and permission is denied', async () => {
    host.send.mockResolvedValue({ success: false })
    wrapper = mount(UnifiedFileTag, {
      props: { paths: [LARK_PATH], clipboardId: 41, preparedThumbnail: THUMBNAIL }
    })
    await flushPromises()
    expect(wrapper.get('img').attributes('src')).toBe(THUMBNAIL)
    expect(host.send).not.toHaveBeenCalled()
    await wrapper.get('img').trigger('error')
    await flushPromises()
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('.file-icon-fallback').exists()).toBe(true)
  })

  it('does not treat an arbitrary stored thumbnail path as prepared authorized image bytes', async () => {
    host.send.mockResolvedValue({ success: false })
    wrapper = mount(UnifiedFileTag, {
      props: {
        paths: [LARK_PATH],
        clipboardId: 41,
        preparedThumbnail: '/uncaptured/secret.png'
      }
    })
    await flushPromises()
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.get('.name').text()).toBe('photo.png')
    expect(wrapper.find('.file-icon-fallback').exists()).toBe(true)
  })

  it('authorizes only the final path and identity when parent props change in one update', async () => {
    // The fake host enforces the same identity/path relationship as the real capture resolver.
    // An intermediate old-id/new-path request is an observable denied resource, not call plumbing.
    const denied: Array<{ path: string; clipboardId: number }> = []
    host.send.mockImplementation(async (event, payload) => {
      if (event !== AppEvents.fileIndex.previewResource) throw new Error('unexpected event')
      if (
        (payload.clipboardId === 41 && payload.path === LARK_PATH) ||
        (payload.clipboardId === 42 && payload.path === '/captured/new.png')
      ) {
        return {
          success: true,
          tfileUrl: `tfile:///record-${payload.clipboardId}.png?previewGrant=valid`
        }
      }
      denied.push(payload)
      return { success: false }
    })
    wrapper = mount(UnifiedFileTag, { props: { paths: [LARK_PATH], clipboardId: 41 } })
    await flushPromises()
    expect(wrapper.get('img').attributes('src')).toContain('record-41.png')
    await wrapper.setProps({
      paths: ['/captured/new.png'],
      clipboardId: 42,
      preparedThumbnail: null
    })
    await flushPromises()
    expect(denied).toEqual([])
    expect(wrapper.get('img').attributes('src')).toBe('tfile:///record-42.png?previewGrant=valid')
    await wrapper.setProps({
      paths: ['/captured/thumb.png'],
      clipboardId: 43,
      preparedThumbnail: THUMBNAIL
    })
    await flushPromises()
    expect(denied).toEqual([])
    expect(wrapper.get('img').attributes('src')).toBe(THUMBNAIL)
  })
})

describe('clipboard FILE autofill resource consumer', () => {
  it('keeps captured identity and prepared thumbnail usable after the clipboard attachment is cleared', async () => {
    capture.latest = {
      id: 991,
      type: 'files',
      content: JSON.stringify([LARK_PATH]),
      thumbnail: THUMBNAIL,
      timestamp: '2026-04-09T12:00:00.000Z',
      captureSource: 'native-watch',
      autoPasteEligible: false
    }
    const box = reactive<IBoxOptions>({
      lastHidden: -1,
      mode: BoxMode.INPUT,
      focus: 0,
      file: { buffer: null, paths: [] },
      data: {},
      layout: undefined
    })
    const clipboard: IClipboardOptions = {
      last: null,
      pendingAutoFillItem: null,
      detectedAt: null,
      lastClearedTimestamp: null
    }
    const hook = useClipboard(box, clipboard)
    try {
      hook.handlePaste({ overrideDismissed: true })
      await flushPromises()
      expect(box.mode).toBe(BoxMode.FILE)
      expect(clipboard.last).toBeNull()
      // Rendering consumes the real autofill result: dropped thumbnail causes an original-file request;
      // dropped identity makes the host deny the captured resource after thumbnail failure.
      host.send.mockImplementation(async (_event, request) => {
        const approved = request.clipboardId === 991 && request.path === LARK_PATH
        return approved
          ? { success: true, tfileUrl: 'tfile:///991.png?previewGrant=approved' }
          : { success: false }
      })
      wrapper = mount(UnifiedFileTag, {
        props: {
          paths: box.file.paths,
          iconPath: box.file.iconPath,
          clipboardId: box.file.clipboardId,
          preparedThumbnail: box.file.thumbnail
        }
      })
      await flushPromises()
      expect(wrapper.get('img').attributes('src')).toBe(THUMBNAIL)
      expect(host.send).not.toHaveBeenCalled()
      await wrapper.get('img').trigger('error')
      await flushPromises()
      expect(wrapper.get('img').attributes('src')).toBe('tfile:///991.png?previewGrant=approved')
    } finally {
      hook.cleanup()
    }
  })
})
