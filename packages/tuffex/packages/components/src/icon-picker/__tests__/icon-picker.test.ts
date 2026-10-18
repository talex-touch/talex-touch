import type { IconPickerEntry, IconPickerLabels } from '../src/types'
import type { VueWrapper } from '@vue/test-utils'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import TxIcon from '../../icon/src/TxIcon.vue'
import { TX_ICON_CONFIG_KEY } from '../../icon/src/types'
import { formatIconIdentifier, parseIconIdentifier } from '../src/identifier'
import TxIconPicker from '../src/TxIconPicker.vue'
import TxIconPickerPanel from '../src/TxIconPickerPanel.vue'

describe('icon identifier', () => {
  it('round-trips every type, including values that contain colons', () => {
    // The split is on the *first* colon. A `split(':')` implementation passes
    // the first three rows and truncates the last two, which are exactly the
    // values a real user produces: a URL with a scheme, a Windows path.
    const cases = [
      ['emoji', '🚀'],
      ['class', 'i-ri-rocket-line'],
      ['builtin', 'star'],
      ['url', 'https://cdn.dev/a.svg?v=2#frag'],
      ['file', 'C:/Users/me/a.png'],
    ] as const

    for (const [type, value] of cases) {
      const identifier = `${type}:${value}`
      expect(parseIconIdentifier(identifier)).toEqual({ type, value })
      expect(formatIconIdentifier({ type, value })).toBe(identifier)
    }
  })

  it('accepts a bare emoji, including sequences a pictographic test alone would miss', () => {
    // `\p{Extended_Pictographic}` matches the base of a ZWJ sequence but not
    // its joiner, so an anchored test on it passes 🚀 and rejects 👨‍💻 — the
    // failure this row exists to catch.
    for (const value of ['🚀', '👨‍💻', '🇨🇳', '👍🏽'])
      expect(parseIconIdentifier(value)).toEqual({ type: 'emoji', value })
  })

  it('rejects anything it would have to guess at', () => {
    // An unprefixed class is the important one: resolving it by shape produces
    // an icon that renders as an empty box with no error raised anywhere.
    const rejected = ['', '   ', 'bogus:x', 'class:', ':value', 'plain text', 'i-ri-rocket-line']

    for (const value of rejected)
      expect(parseIconIdentifier(value)).toBeNull()
  })

  it('formats a missing or valueless source as the empty identifier', () => {
    expect(formatIconIdentifier(null)).toBe('')
    expect(formatIconIdentifier(undefined)).toBe('')
    expect(formatIconIdentifier({ type: 'emoji', value: '' })).toBe('')
  })
})

const LABELS: IconPickerLabels = {
  ai: 'AI',
  emoji: 'Emoji',
  icon: 'Icons',
  brand: 'Brands',
  file: 'File',
  search: 'Search icons',
  empty: 'No matching icon',
  clear: 'Clear',
  chooseFile: 'Choose local file',
  shape: 'Shape',
  shapeCircle: 'Circle',
  shapeRounded: 'Rounded',
  shapeSquare: 'Square',
}

const ASSISTANT: IconPickerEntry = {
  id: 'class:i-ri-chat-ai-line',
  icon: { type: 'class', value: 'i-ri-chat-ai-line' },
  keywords: 'ai chat assistant',
}
const MESSAGE: IconPickerEntry = {
  id: 'class:i-ri-message-3-line',
  icon: { type: 'class', value: 'i-ri-message-3-line' },
  keywords: 'chat message',
}

const BRAND_GITHUB: IconPickerEntry = {
  id: 'class:i-simple-icons-github',
  icon: { type: 'class', value: 'i-simple-icons-github' },
  keywords: 'github code hosting',
}
const AI_COPILOT: IconPickerEntry = {
  id: 'class:i-ri-sparkling-2-line',
  icon: { type: 'class', value: 'i-ri-sparkling-2-line' },
  keywords: 'copilot ai assistant',
}
const HOST_FILE: IconPickerEntry = {
  id: 'file:/icons/host.png',
  icon: { type: 'file', value: '/icons/host.png' },
  keywords: 'host file',
}
const HOST_URL: IconPickerEntry = {
  id: 'url:/icons/host.svg',
  icon: { type: 'url', value: '/icons/host.svg' },
  keywords: 'host url',
}

const MULTI_CATALOG = {
  icon: [MESSAGE],
  brand: [BRAND_GITHUB],
  ai: [AI_COPILOT],
}

const HOST_CATALOG = {
  icon: [ASSISTANT, HOST_FILE, HOST_URL],
}

/** An explicit catalog, so no assertion depends on the bundled rows. */
const CATALOG = { icon: [ASSISTANT, MESSAGE] }

type PanelWrapper = VueWrapper<InstanceType<typeof TxIconPickerPanel>>

function mountPanel(props: Record<string, unknown> = {}): PanelWrapper {
  return mount(TxIconPickerPanel, {
    props: {
      modelValue: '',
      shape: 'rounded',
      sections: ['icon'],
      catalog: CATALOG,
      shapeSelectable: true,
      labels: LABELS,
      disabled: false,
      accept: 'image/*',
      hasFileChooser: false,
      fileBusy: false,
      ...props,
    },
  })
}

async function search(wrapper: PanelWrapper, query: string): Promise<void> {
  await wrapper.find('.tx-icon-picker-panel__search-input').setValue(query)
  await nextTick()
}

describe('txIconPickerPanel search', () => {
  it('narrows conjunctively across terms', async () => {
    const wrapper = mountPanel()
    expect(wrapper.findAll('.tx-icon-picker-panel__cell')).toHaveLength(2)

    // Both entries carry "chat"; only one carries "ai". Matching the joined
    // query, or OR-ing the terms, leaves both.
    await search(wrapper, 'ai chat')

    const cells = wrapper.findAll('.tx-icon-picker-panel__cell')
    expect(cells).toHaveLength(1)
    expect(cells[0].attributes('title')).toBe('i-ri-chat-ai-line')
  })

  it('matches the icon value, not only the keywords', async () => {
    const wrapper = mountPanel()
    // "message-3" appears in no keyword list — only in the class itself.
    await search(wrapper, 'message-3')

    const cells = wrapper.findAll('.tx-icon-picker-panel__cell')
    expect(cells).toHaveLength(1)
    expect(cells[0].attributes('title')).toBe('i-ri-message-3-line')
  })

  it('shows the empty label and no cells when nothing matches', async () => {
    const wrapper = mountPanel()
    await search(wrapper, 'zzz-no-such-icon')

    expect(wrapper.findAll('.tx-icon-picker-panel__cell')).toHaveLength(0)
    expect(wrapper.find('.tx-icon-picker-panel__empty').text()).toBe(LABELS.empty)
  })

  it('restores the full grid through resetQuery', async () => {
    const wrapper = mountPanel()
    await search(wrapper, 'assistant')
    expect(wrapper.findAll('.tx-icon-picker-panel__cell')).toHaveLength(1)

    // The host calls this when the panel closes, so reopening never shows a
    // filter the user did not ask for.
    wrapper.vm.resetQuery()
    await nextTick()

    expect(wrapper.findAll('.tx-icon-picker-panel__cell')).toHaveLength(2)
  })

  it('searches AI, brand, and icon sections and selects each actual entry id', async () => {
    const cases = [
      ['message', MESSAGE],
      ['github', BRAND_GITHUB],
      ['copilot', AI_COPILOT],
    ] as const

    for (const [query, expected] of cases) {
      const wrapper = mountPanel({
        sections: ['icon', 'brand', 'ai'],
        catalog: MULTI_CATALOG,
      })
      await search(wrapper, query)

      const cells = wrapper.findAll('.tx-icon-picker-panel__cell')
      expect(cells).toHaveLength(1)
      expect(cells[0]!.attributes('title')).toBe(expected.icon.value)
      await cells[0]!.trigger('click')
      expect(wrapper.emitted('select')).toEqual([[expected]])
    }
  })
})

describe('txIconPicker host icon config', () => {
  it('preserves host transports and gives a host class glyph precedence', async () => {
    const hostResolver = (value: string, type: 'url' | 'file') => `host://${type}${value}`
    const hostSvgFetcher = async () => '<svg><title>PICKER_HOST_SVG</title></svg>'
    const hostGlyph = (className: string) => className === ASSISTANT.icon.value
      ? { d: 'M0 0H32V16H0Z', viewBox: '0 0 32 16' }
      : null

    const wrapper = mount(TxIconPicker, {
      props: {
        inline: true,
        sections: ['icon'],
        catalog: HOST_CATALOG,
        shapeSelectable: false,
      },
      global: {
        provide: {
          [TX_ICON_CONFIG_KEY as symbol]: {
            urlResolver: hostResolver,
            svgFetcher: hostSvgFetcher,
            fileProtocol: 'tfile://',
            classGlyph: hostGlyph,
          },
        },
      },
    })
    await nextTick()

    const hostPath = wrapper.find('path[d="M0 0H32V16H0Z"]')
    expect(hostPath.exists()).toBe(true)
    expect((hostPath.element.closest('svg') as SVGSVGElement | null)?.getAttribute('viewBox')).toBe('0 0 32 16')
    expect(wrapper.find('img[src="host://file/icons/host.png"]').exists()).toBe(true)

    const uncolored = mount(TxIcon, {
      props: { icon: HOST_URL.icon, colorful: false },
      global: {
        provide: {
          [TX_ICON_CONFIG_KEY as symbol]: { svgFetcher: hostSvgFetcher },
        },
      },
    })
    await nextTick()
    await nextTick()
    const mask = uncolored.find('.tuff-icon__svg-mask')
    expect(mask.exists()).toBe(true)
    expect(mask.attributes('style')).toContain('PICKER_HOST_SVG')
  })
})

describe('txIconPickerPanel selection', () => {
  it('emits the selected entry', async () => {
    const wrapper = mountPanel()
    await wrapper.findAll('.tx-icon-picker-panel__cell')[1].trigger('click')

    expect(wrapper.emitted('select')).toEqual([[MESSAGE]])
  })

  it('marks only the entry matching modelValue as selected', () => {
    const wrapper = mountPanel({ modelValue: MESSAGE.id })
    const cells = wrapper.findAll('.tx-icon-picker-panel__cell')

    expect(cells[0].attributes('aria-selected')).toBe('false')
    expect(cells[1].attributes('aria-selected')).toBe('true')
  })

  it('enables clear only when an icon is set', async () => {
    const empty = mountPanel()
    const clear = () => empty.findAll('.tx-icon-picker-panel__action').at(-1)!
    expect(clear().attributes('disabled')).toBeDefined()

    await empty.setProps({ modelValue: ASSISTANT.id })
    expect(clear().attributes('disabled')).toBeUndefined()

    await clear().trigger('click')
    expect(empty.emitted('clear')).toHaveLength(1)
  })

  it('routes the file action to the host chooser only when it has one', async () => {
    const hosted = mountPanel({ sections: ['icon', 'file'], hasFileChooser: true })
    await hosted.find('.tx-icon-picker-panel__action').trigger('click')
    expect(hosted.emitted('choose-file')).toHaveLength(1)
    // With a host chooser there is no fallback input to leave lying around.
    expect(hosted.find('.tx-icon-picker-panel__file').exists()).toBe(false)

    const standalone = mountPanel({ sections: ['icon', 'file'], hasFileChooser: false })
    await standalone.find('.tx-icon-picker-panel__action').trigger('click')
    expect(standalone.emitted('choose-file')).toBeUndefined()
    expect(standalone.find('.tx-icon-picker-panel__file').exists()).toBe(true)
  })

  it('omits the file action entirely when the section is not offered', () => {
    const wrapper = mountPanel({ sections: ['icon'] })
    const actions = wrapper.findAll('.tx-icon-picker-panel__action')

    // Only `clear` remains; an action that opens nothing is worse than absent.
    expect(actions).toHaveLength(1)
    expect(actions[0].text()).toBe(LABELS.clear)
  })
})

describe('txIconPickerPanel sections', () => {
  it('hides the tab bar when a single section is offered', () => {
    // A one-tab bar reads as a broken control, not as a choice.
    expect(mountPanel({ sections: ['icon'] }).find('.tx-icon-picker-panel__tabs').exists()).toBe(false)
    expect(mountPanel({ sections: ['icon', 'file'] }).find('.tx-icon-picker-panel__tabs').exists()).toBe(false)

    const many = mountPanel({ sections: ['emoji', 'icon'] })
    expect(many.find('.tx-icon-picker-panel__tabs').exists()).toBe(true)
    expect(many.findAll('.tx-icon-picker-panel__tab')).toHaveLength(2)
  })

  it('falls back to a surviving section when the active one is withdrawn', async () => {
    const wrapper = mountPanel({
      sections: ['emoji', 'icon'],
      catalog: { ...CATALOG, emoji: [] },
    })
    await wrapper.findAll('.tx-icon-picker-panel__tab')[0].trigger('click')
    expect(wrapper.findAll('.tx-icon-picker-panel__cell')).toHaveLength(0)

    // A host narrowing `sections` at runtime would otherwise leave the panel
    // pointed at a section with no tab and no grid behind it.
    await wrapper.setProps({ sections: ['icon'] })

    expect(wrapper.findAll('.tx-icon-picker-panel__cell')).toHaveLength(2)
  })

  it('reports a selected shape and keeps one current radio', async () => {
    const wrapper = mountPanel({ shape: 'rounded' })
    const shapes = wrapper.findAll('.tx-icon-picker-panel__shape')
    const checkedShapes = shapes.filter(shape => shape.attributes('aria-checked') === 'true')

    expect(checkedShapes).toHaveLength(1)
    expect(checkedShapes[0]!.attributes('aria-label')).toBe('rounded')

    const target = shapes.find(shape => shape.attributes('aria-label') === 'heart')
    expect(target).toBeDefined()
    await target!.trigger('click')

    expect(wrapper.emitted('select-shape')).toEqual([['heart']])
    await wrapper.setProps({ shape: 'heart' })
    const updatedCheckedShapes = shapes.filter(shape => shape.attributes('aria-checked') === 'true')
    expect(updatedCheckedShapes).toHaveLength(1)
    expect(updatedCheckedShapes[0]!.attributes('aria-label')).toBe('heart')
  })
})
