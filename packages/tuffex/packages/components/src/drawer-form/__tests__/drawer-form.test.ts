import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import TxFormItem from '../../form/src/TxFormItem.vue'
import TuffInput from '../../input/src/TxInput.vue'
import TxDrawerForm from '../src/TxDrawerForm.vue'

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

function mountDrawerForm(setup: { onSubmit?: () => unknown, leaveConfirm?: unknown } = {}) {
  const visible = ref(true)
  const wrapper = mount({
    components: { TxDrawerForm, TxFormItem, TuffInput },
    setup: () => ({
      visible,
      initialValues: { name: 'Ann' },
      onSubmit: setup.onSubmit,
      leaveConfirm: setup.leaveConfirm,
      drawerRef: ref<any>(null),
    }),
    template: `
      <TxDrawerForm
        ref="drawerRef"
        v-model:visible="visible"
        title="Edit member"
        :initial-values="initialValues"
        :leave-confirm="leaveConfirm"
        @submit="onSubmit"
      >
        <template #default="{ model }">
          <TxFormItem prop="name" label="Name">
            <TuffInput v-model="model.name" />
          </TxFormItem>
        </template>
      </TxDrawerForm>
    `,
  }, { attachTo: document.body })
  return { wrapper, visible, drawer: () => (wrapper.vm as any).drawerRef }
}

function input(): HTMLInputElement {
  return document.body.querySelector<HTMLInputElement>('.tx-drawer__body input')!
}

async function type(value: string): Promise<void> {
  input().value = value
  input().dispatchEvent(new Event('input'))
  await nextTick()
}

function footerButton(type: 'button' | 'submit'): HTMLButtonElement {
  return document.body.querySelector<HTMLButtonElement>(`.tx-drawer__footer button[type="${type}"]`)!
}

/**
 * A mouse click. A click with `detail` 0 comes from a key, and starts the
 * button's ripple, whose timers outlive the test.
 */
function click(button: HTMLElement): void {
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
}

function leaveEvent(): Event {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event
}

describe('txDrawerForm', () => {
  it('submits from the footer, then closes', async () => {
    const onSubmit = vi.fn()
    const { visible } = mountDrawerForm({ onSubmit })
    await flushPromises()

    await type('Bea')
    click(footerButton('submit'))
    await flushPromises()
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Bea' }, expect.any(Event))
    expect(visible.value).toBe(false)
  })

  it('keeps nothing to lose once closed, and opens again on the values it is given', async () => {
    const leaveConfirm = vi.fn(() => true)
    const { visible, drawer } = mountDrawerForm({ leaveConfirm })
    await flushPromises()

    await type('Bea')
    expect(leaveEvent().defaultPrevented).toBe(true)
    click(footerButton('button'))
    await flushPromises()
    expect(leaveConfirm).toHaveBeenCalledTimes(1)
    expect(visible.value).toBe(false)
    // The drawer keeps its content, and the form with it; the user said to go.
    expect(drawer().form).not.toBeNull()
    expect(leaveEvent().defaultPrevented).toBe(false)

    visible.value = true
    await flushPromises()
    expect(input().value).toBe('Ann')
    expect(drawer().form.dirty).toBe(false)
  })
})
