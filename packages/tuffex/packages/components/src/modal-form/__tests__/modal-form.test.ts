import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import TxFormItem from '../../form/src/TxFormItem.vue'
import TuffInput from '../../input/src/TxInput.vue'
import TxModalForm from '../src/TxModalForm.vue'

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

interface Setup {
  onSubmit?: (values: Record<string, unknown>) => unknown
  leaveConfirm?: unknown
}

function mountModalForm(setup: Setup = {}) {
  const open = ref(true)
  const initialValues = ref<Record<string, unknown>>({ name: 'Ann', team: 'Design' })
  const wrapper = mount({
    components: { TxModalForm, TxFormItem, TuffInput },
    setup: () => ({
      open,
      initialValues,
      rules: { name: { required: true } },
      onSubmit: setup.onSubmit,
      leaveConfirm: setup.leaveConfirm,
      modalRef: ref<any>(null),
    }),
    template: `
      <TxModalForm
        ref="modalRef"
        v-model="open"
        title="Edit member"
        :initial-values="initialValues"
        :rules="rules"
        :leave-confirm="leaveConfirm"
        @submit="onSubmit"
      >
        <template #default="{ model }">
          <TxFormItem prop="name" label="Name">
            <TuffInput v-model="model.name" />
          </TxFormItem>
          <TxFormItem prop="team" label="Team">
            <TuffInput v-model="model.team" />
          </TxFormItem>
        </template>
      </TxModalForm>
    `,
  }, { attachTo: document.body })
  return {
    wrapper,
    open,
    initialValues,
    modal: () => (wrapper.vm as any).modalRef,
    emitted: (event: string) => wrapper.findComponent(TxModalForm).emitted(event),
  }
}

function inputs(): HTMLInputElement[] {
  return [...document.body.querySelectorAll<HTMLInputElement>('.tx-modal__body input')]
}

async function type(input: HTMLInputElement | undefined, value: string): Promise<void> {
  input!.value = value
  input!.dispatchEvent(new Event('input'))
  await nextTick()
}

function footerButton(type: 'button' | 'submit'): HTMLButtonElement {
  return document.body.querySelector<HTMLButtonElement>(`.tx-modal__footer button[type="${type}"]`)!
}

/**
 * A mouse click. A click with `detail` 0 comes from a key, and starts the
 * button's ripple, whose timers outlive the test.
 */
function click(button: HTMLElement): void {
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
}

function pressEscape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

describe('txModalForm', () => {
  it('submits from the footer through the form attribute, then closes', async () => {
    const onSubmit = vi.fn()
    const { open, initialValues, emitted } = mountModalForm({ onSubmit })
    await flushPromises()

    const form = document.body.querySelector('form')!
    expect(footerButton('submit').getAttribute('form')).toBe(form.id)
    expect(form.contains(footerButton('submit'))).toBe(false)

    await type(inputs()[0], 'Bea')
    click(footerButton('submit'))
    await flushPromises()

    expect(onSubmit).toHaveBeenCalledWith({ name: 'Bea', team: 'Design' }, expect.any(Event))
    expect(emitted('submit-success')?.[0]).toEqual([{ name: 'Bea', team: 'Design' }])
    expect(open.value).toBe(false)
    // The dialog edited a copy.
    expect(initialValues.value).toEqual({ name: 'Ann', team: 'Design' })
  })

  it('stays open when the check or the save fails', async () => {
    const onSubmit = vi.fn(() => false)
    const { open } = mountModalForm({ onSubmit })
    await flushPromises()

    await type(inputs()[0], '')
    click(footerButton('submit'))
    await flushPromises()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(open.value).toBe(true)

    await type(inputs()[0], 'Bea')
    click(footerButton('submit'))
    await flushPromises()
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(open.value).toBe(true)
  })

  it('asks before Escape or Cancel throws changes away', async () => {
    const leaveConfirm = vi.fn(() => false)
    const { open } = mountModalForm({ leaveConfirm })
    await flushPromises()

    // Nothing changed: nothing to ask.
    pressEscape()
    await flushPromises()
    expect(leaveConfirm).not.toHaveBeenCalled()
    expect(open.value).toBe(false)

    open.value = true
    await flushPromises()
    await type(inputs()[0], 'Bea')
    pressEscape()
    await flushPromises()
    expect(leaveConfirm).toHaveBeenCalledWith({ unsaved: [{ path: 'name', label: 'Name' }], persisted: false })
    expect(open.value).toBe(true)

    leaveConfirm.mockReturnValue(true)
    click(footerButton('button'))
    await flushPromises()
    expect(leaveConfirm).toHaveBeenCalledTimes(2)
    expect(open.value).toBe(false)
  })

  it('keeps the dialog open while a save runs', async () => {
    let finish!: () => void
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => {
      finish = resolve
    }))
    const { open } = mountModalForm({ onSubmit, leaveConfirm: () => true })
    await flushPromises()

    click(footerButton('submit'))
    await flushPromises()
    expect(footerButton('button').disabled).toBe(true)
    pressEscape()
    await flushPromises()
    expect(open.value).toBe(true)

    finish()
    await flushPromises()
    expect(open.value).toBe(false)
  })

  it('opens each time on the values it is given, and takes new ones as the saved state', async () => {
    const { open, initialValues, modal } = mountModalForm({ leaveConfirm: () => true })
    await flushPromises()

    await type(inputs()[0], 'Bea')
    click(footerButton('button'))
    await flushPromises()
    expect(open.value).toBe(false)
    expect(modal().form).toBeNull()

    open.value = true
    await flushPromises()
    expect(inputs().map(input => input.value)).toEqual(['Ann', 'Design'])
    expect(modal().form.dirty).toBe(false)

    // A record loaded while the dialog is open: the field being edited keeps its edit.
    await type(inputs()[0], 'Cy')
    initialValues.value = { name: 'Dee', team: 'Research' }
    await flushPromises()
    expect(inputs().map(input => input.value)).toEqual(['Cy', 'Research'])
    expect(modal().form.dirty).toBe(true)
  })
})
