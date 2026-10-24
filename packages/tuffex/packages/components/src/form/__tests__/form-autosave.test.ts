import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive, ref } from 'vue'
import TuffInput from '../../input/src/TxInput.vue'
import TxForm from '../src/TxForm.vue'
import TxFormItem from '../src/TxFormItem.vue'

const components = { TxForm, TxFormItem, TuffInput }

enableAutoUnmount(afterEach)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

function mountAutosaving(onSubmit: (values: Record<string, unknown>) => unknown = vi.fn()) {
  const model = ref<Record<string, any>>(reactive({ name: 'Ann', email: 'ann@example.com' }))
  const wrapper = mount({
    components,
    setup: () => ({ model, onSubmit, rules: { email: { type: 'email' } }, formRef: ref<any>(null) }),
    template: `
      <TxForm ref="formRef" :model="model" :rules="rules" autosave @submit="onSubmit">
        <TxFormItem prop="name" label="Name">
          <TuffInput v-model="model.name" />
        </TxFormItem>
        <TxFormItem prop="email" label="Email">
          <TuffInput v-model="model.email" />
        </TxFormItem>
      </TxForm>
    `,
  }, { attachTo: document.body })
  return {
    wrapper,
    model,
    form: () => (wrapper.vm as any).formRef,
    status: () => wrapper.find('.tx-form__status').text(),
    emitted: (event: string) => wrapper.findComponent(TxForm).emitted(event),
  }
}

describe('txForm autosave', () => {
  it('saves once editing pauses and says so politely', async () => {
    const onSubmit = vi.fn()
    const { model, form, status, emitted } = mountAutosaving(onSubmit)

    model.value.name = 'Be'
    await nextTick()
    vi.advanceTimersByTime(600)
    model.value.name = 'Bea'
    await nextTick()
    vi.advanceTimersByTime(999)
    await flushPromises()
    expect(onSubmit).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Bea', email: 'ann@example.com' }, undefined)
    expect(emitted('submit-success')).toEqual([[{ name: 'Bea', email: 'ann@example.com' }]])
    expect(form().dirty).toBe(false)
    expect(status()).toBe('Changes saved.')
  })

  it('keeps a field with an error unsaved and saves the rest', async () => {
    const onSubmit = vi.fn()
    const { wrapper, model, form, status } = mountAutosaving(onSubmit)

    model.value.email = 'nope'
    await nextTick()
    vi.advanceTimersByTime(1000)
    await flushPromises()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(wrapper.find('.tx-form-item__message-text').text()).toBe('Email must be an email address')
    expect(status()).toBe('Error: Email must be an email address')

    model.value.name = 'Bea'
    await nextTick()
    vi.advanceTimersByTime(1000)
    await flushPromises()
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Bea', email: 'ann@example.com' }, undefined)
    // Still the user's, still unsaved.
    expect(model.value.email).toBe('nope')
    expect(form().dirty).toBe(true)

    model.value.email = 'bea@example.com'
    await nextTick()
    vi.advanceTimersByTime(1000)
    await flushPromises()
    expect(onSubmit).toHaveBeenLastCalledWith({ name: 'Bea', email: 'bea@example.com' }, undefined)
    expect(form().dirty).toBe(false)
  })

  it('says when a save fails and keeps the changes', async () => {
    const { model, form, status } = mountAutosaving(() => false)
    model.value.name = 'Bea'
    await nextTick()
    vi.advanceTimersByTime(1000)
    await flushPromises()
    expect(status()).toBe('Your changes could not be saved.')
    expect(form().dirty).toBe(true)
  })

  it('saves at once on submit, and before leaving', async () => {
    const onSubmit = vi.fn()
    const { model, form } = mountAutosaving(onSubmit)

    model.value.name = 'Bea'
    await nextTick()
    expect(await form().submit()).toBe(true)
    expect(onSubmit).toHaveBeenCalledTimes(1)

    model.value.name = 'Cy'
    await nextTick()
    const leaving = form().confirmLeave()
    expect(await leaving).toBe(true)
    expect(onSubmit).toHaveBeenCalledTimes(2)
    expect(onSubmit).toHaveBeenLastCalledWith({ name: 'Cy', email: 'ann@example.com' }, undefined)

    // The timers were cancelled: nothing saves twice.
    vi.advanceTimersByTime(1000)
    await flushPromises()
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })

  it('saves what passed its checks when it unmounts inside the pause', async () => {
    const onSubmit = vi.fn()
    const { wrapper, model } = mountAutosaving(onSubmit)
    model.value.name = 'Bea'
    model.value.email = 'nope'
    await nextTick()
    wrapper.unmount()
    await flushPromises()
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Bea', email: 'ann@example.com' }, undefined)
  })

  it('drops the pending save when another record arrives', async () => {
    const onSubmit = vi.fn()
    const { model } = mountAutosaving(onSubmit)
    model.value.name = 'Bea'
    await nextTick()
    model.value = reactive({ name: 'Dee', email: 'dee@example.com' })
    await nextTick()
    vi.advanceTimersByTime(1000)
    await flushPromises()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('leaves the next record alone when a save for the last one finishes', async () => {
    let finish!: () => void
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => {
      finish = resolve
    }))
    const { model, form, emitted } = mountAutosaving(onSubmit)
    model.value.name = 'Bea'
    await nextTick()
    vi.advanceTimersByTime(1000)
    await flushPromises()
    expect(onSubmit).toHaveBeenCalledTimes(1)

    model.value = reactive({ name: 'Dee', email: 'dee@example.com' })
    await nextTick()
    model.value.name = 'Eve'
    await nextTick()
    finish()
    await flushPromises()
    expect(emitted('submit-success')).toBeUndefined()
    // The saved state is still the record that arrived.
    form().reset()
    expect(model.value).toEqual({ name: 'Dee', email: 'dee@example.com' })
  })
})
