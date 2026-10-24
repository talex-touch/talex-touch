import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive, ref } from 'vue'
import { clearTxFormDrafts } from '../../form/src/draft'
import TxFormItem from '../../form/src/TxFormItem.vue'
import TuffInput from '../../input/src/TxInput.vue'
import TxFormStep from '../src/TxFormStep.vue'
import TxStepsForm from '../src/TxStepsForm.vue'

/** Node's own storage shadows jsdom's and is empty without `--localstorage-file`. */
class MemoryStorage {
  private items = new Map<string, string>()
  get length(): number {
    return this.items.size
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.items.set(key, String(value))
  }

  removeItem(key: string): void {
    this.items.delete(key)
  }

  clear(): void {
    this.items.clear()
  }
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: new MemoryStorage() })
  Object.defineProperty(window, 'sessionStorage', { configurable: true, value: new MemoryStorage() })
})

afterEach(async () => {
  await clearTxFormDrafts()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

function mountStepsForm(setup: { onSubmit?: () => unknown, persist?: unknown } = {}) {
  const model = reactive({ name: '', email: '', plan: '' })
  const wrapper = mount({
    components: { TxStepsForm, TxFormStep, TxFormItem, TuffInput },
    setup: () => ({
      model,
      rules: { name: { required: true }, email: { required: true }, plan: { required: true } },
      onSubmit: setup.onSubmit,
      persist: setup.persist ?? false,
      active: ref(0),
      stepsRef: ref<any>(null),
    }),
    template: `
      <TxStepsForm id="signup" ref="stepsRef" v-model:active="active" :model="model" :rules="rules" :persist="persist" @submit="onSubmit">
        <TxFormStep title="Name">
          <TxFormItem prop="name" label="Name">
            <TuffInput v-model="model.name" />
          </TxFormItem>
        </TxFormStep>
        <TxFormStep title="Contact">
          <TxFormItem prop="email" label="Email">
            <TuffInput v-model="model.email" />
          </TxFormItem>
        </TxFormStep>
        <TxFormStep title="Plan">
          <TxFormItem prop="plan" label="Plan">
            <TuffInput v-model="model.plan" />
          </TxFormItem>
        </TxFormStep>
      </TxStepsForm>
    `,
  }, { attachTo: document.body })
  return {
    wrapper,
    model,
    active: () => (wrapper.vm as any).active as number,
    steps: () => (wrapper.vm as any).stepsRef,
    panels: () => wrapper.findAll<HTMLElement>('.tx-form-step').map(panel => panel.element),
    shown: () => wrapper.findAll<HTMLElement>('.tx-form-step').findIndex(panel => panel.element.style.display !== 'none'),
    submitButton: () => wrapper.find<HTMLButtonElement>('.tx-steps-form__actions button[type="submit"]'),
    messages: () => wrapper.findAll('.tx-form-item__message-text').map(message => message.text()),
  }
}

describe('txStepsForm', () => {
  it('lists the steps and shows only the current one', async () => {
    const { wrapper, shown, panels, submitButton } = mountStepsForm()
    await flushPromises()

    expect(wrapper.findAll('.tx-step__title').map(title => title.text())).toEqual(['Name', 'Contact', 'Plan'])
    expect(shown()).toBe(0)
    expect(panels()[1]?.getAttribute('role')).toBe('group')
    expect(panels()[1]?.getAttribute('aria-label')).toBe('Contact')
    expect(submitButton().text()).toBe('Next')
  })

  it('checks only the fields of the step it leaves', async () => {
    const onSubmit = vi.fn()
    const { wrapper, model, active, shown, panels, messages } = mountStepsForm({ onSubmit })
    await flushPromises()

    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(active()).toBe(0)
    expect(messages()).toEqual(['Name is required'])
    expect(document.activeElement).toBe(panels()[0]?.querySelector('input'))

    model.name = 'Ann'
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(active()).toBe(1)
    expect(shown()).toBe(1)
    // Moving on is not submitting: the next step says nothing yet.
    expect(messages()).toEqual([])
    expect(document.activeElement).toBe(panels()[1])
    expect(onSubmit).not.toHaveBeenCalled()

    // A mouse click: one from a key starts the button's ripple, whose timers outlive the test.
    const back = wrapper.find('.tx-steps-form__actions button[type="button"]').element
    back.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
    await nextTick()
    expect(active()).toBe(0)
  })

  it('submits on the last step, and goes back to a step whose field fails', async () => {
    const onSubmit = vi.fn()
    const { wrapper, model, active, panels, submitButton } = mountStepsForm({ onSubmit })
    await flushPromises()

    model.name = 'Ann'
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    model.email = 'ann@example.com'
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(active()).toBe(2)
    expect(submitButton().text()).toBe('Submit')

    // Cleared behind the user's back, as a draft or a parent may do.
    model.name = ''
    model.plan = 'Team'
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(active()).toBe(0)
    expect(document.activeElement).toBe(panels()[0]?.querySelector('input'))

    model.name = 'Ann'
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Ann', email: 'ann@example.com', plan: 'Team' }, expect.any(Event))
  })

  it('keeps the step in the draft and goes back to it', async () => {
    const first = mountStepsForm({ persist: { storage: 'session' } })
    await flushPromises()
    first.model.name = 'Ann'
    await first.wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(first.active()).toBe(1)
    await first.steps().form.flush()
    first.wrapper.unmount()

    const second = mountStepsForm({ persist: { storage: 'session' } })
    await flushPromises()
    expect(second.model.name).toBe('Ann')
    expect(second.active()).toBe(1)
    expect(second.shown()).toBe(1)
  })
})
