// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingBetaFeatures from './SettingBetaFeatures.vue'

const appSettingMock = vi.hoisted(() => ({
  betaFeatures: {
    screenshot: false,
    voiceDictation: false,
    voiceQuickEdit: false,
    omniPanel: false,
    browserWorkspace: false
  }
}))

vi.mock('~/modules/storage/app-storage', () => ({
  appSetting: appSettingMock
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

describe('SettingBetaFeatures', () => {
  beforeEach(() => {
    appSettingMock.betaFeatures.browserWorkspace = false
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders the experimental feature switch off by default', () => {
    const wrapper = mount(SettingBetaFeatures)
    const switchEl = wrapper.find('[data-testid="beta-feature-browser-workspace"]')
    expect(switchEl.exists()).toBe(true)
    expect(wrapper.text()).toContain('settings.betaFeatures.browserWorkspace.title')
  })

  it('updates appSetting.betaFeatures.browserWorkspace when toggled', async () => {
    const wrapper = mount(SettingBetaFeatures)
    const blockSwitch = wrapper.findComponent({ name: 'TuffBlockSwitch' })
    expect(blockSwitch.exists()).toBe(true)

    // Simulate toggle on
    blockSwitch.vm.$emit('update:modelValue', true)
    await flushPromises()
    expect(appSettingMock.betaFeatures.browserWorkspace).toBe(true)

    // Simulate toggle off
    blockSwitch.vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(appSettingMock.betaFeatures.browserWorkspace).toBe(false)
  })
})
