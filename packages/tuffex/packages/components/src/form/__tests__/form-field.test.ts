import type { FormRules } from '../src/types'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, nextTick, reactive, ref } from 'vue'
import TxBlockInput from '../../group-block/src/TxBlockInput.vue'
import TuffInput from '../../input/src/TxInput.vue'
import TxRadio from '../../radio/src/TxRadio.vue'
import TxRadioGroup from '../../radio/src/TxRadioGroup.vue'
import TxSelect from '../../select/src/TxSelect.vue'
import TxSelectItem from '../../select/src/TxSelectItem.vue'
import TxSwitch from '../../switch/src/TxSwitch.vue'
import TxForm from '../src/TxForm.vue'
import TxFormItem from '../src/TxFormItem.vue'
import TxFormRow from '../src/TxFormRow.vue'

const PopoverStub = defineComponent({
  name: 'TxPopover',
  props: { modelValue: { type: Boolean, default: false } },
  emits: ['update:modelValue'],
  template: '<div><slot name="reference" /><div v-if="modelValue"><slot /></div></div>',
})

const components = { TxForm, TxFormItem, TxFormRow, TuffInput, TxSwitch, TxRadio, TxRadioGroup, TxSelect, TxSelectItem, TxBlockInput }

function mountForm(template: string, state: Record<string, unknown> = {}) {
  return mount({
    components,
    setup() {
      const model = reactive<Record<string, any>>({ name: '', email: '', notify: false, plan: 'free', lang: '', ...state })
      const formRef = ref<any>(null)
      return { model, formRef }
    },
    template,
  }, { global: { stubs: { TxPopover: PopoverStub } } })
}

describe('txForm layout', () => {
  it('defaults to auto with end-aligned labels', () => {
    const wrapper = mountForm(`
      <TxForm :model="model">
        <TxFormItem prop="name" label="Name"><TuffInput v-model="model.name" /></TxFormItem>
      </TxForm>
    `)
    expect(wrapper.find('form').classes()).toEqual(expect.arrayContaining(['tx-form--auto', 'tx-form--label-end']))
    expect(wrapper.find('.tx-form-item').classes()).toEqual(expect.arrayContaining(['tx-form-item--auto', 'tx-form-item--label-end']))
  })

  it('maps the older labelPosition onto layout and label alignment', () => {
    const top = mountForm(`<TxForm :model="model" label-position="top" />`)
    expect(top.find('form').classes()).toContain('tx-form--stacked')

    const left = mountForm(`<TxForm :model="model" label-position="left" label-width="120px" />`)
    expect(left.find('form').classes()).toEqual(expect.arrayContaining(['tx-form--side', 'tx-form--label-start']))
    expect(left.find('form').attributes('style')).toContain('--tx-form-label-max: 120px')
  })

  it('stacks items inside a row, which names them as a group', () => {
    const wrapper = mountForm(`
      <TxForm :model="model" layout="side">
        <TxFormRow label="Contact">
          <TxFormItem prop="name" label="Name" width="sm"><TuffInput v-model="model.name" /></TxFormItem>
          <TxFormItem prop="email" label="Email"><TuffInput v-model="model.email" /></TxFormItem>
        </TxFormRow>
      </TxForm>
    `)
    const row = wrapper.find('.tx-form-row')
    expect(row.classes()).toContain('tx-form-row--side')
    expect(row.attributes('role')).toBe('group')
    expect(wrapper.find(`#${row.attributes('aria-labelledby')}`).text()).toBe('Contact')

    const items = wrapper.findAll('.tx-form-item')
    expect(items.every(item => item.classes().includes('tx-form-item--stacked'))).toBe(true)
    expect(items[0].classes()).toContain('tx-form-item--w-sm')
  })
})

describe('txForm field contract', () => {
  it('gives the first control the id and points the others at the label', async () => {
    const wrapper = mountForm(`
      <TxForm id="f" ref="formRef" :model="model">
        <TxFormItem prop="name" label="Name" help="As on your passport" required>
          <TuffInput v-model="model.name" aria-describedby="hint" />
          <TuffInput v-model="model.email" />
        </TxFormItem>
        <span id="hint">Latin letters only</span>
      </TxForm>
    `)
    const [first, second] = wrapper.findAll('input')
    expect(first.attributes('id')).toBe('f-name')
    expect(first.attributes('required')).toBeDefined()
    expect(first.attributes('aria-describedby')?.split(' ').sort()).toEqual(['f-name-message', 'hint'])
    expect(first.attributes('aria-labelledby')).toBeUndefined()

    expect(second.attributes('id')).toBeUndefined()
    expect(second.attributes('aria-labelledby')).toBe('f-name-label')

    expect(await (wrapper.vm as any).formRef.validate()).toBe(false)
    await nextTick()
    expect(first.attributes('aria-invalid')).toBe('true')
    expect(wrapper.find('.tx-input').classes()).toContain('is-invalid')
  })

  it('leaves a control outside every item alone, and disables controls with the form', async () => {
    const wrapper = mountForm(`
      <TxForm :model="model" :disabled="model.locked">
        <TuffInput v-model="model.name" />
        <TxFormItem prop="email" label="Email"><TuffInput v-model="model.email" /></TxFormItem>
      </TxForm>
    `, { locked: false })
    const [loose, field] = wrapper.findAll('input')
    expect(loose.attributes('id')).toBeUndefined()
    expect(field.attributes('disabled')).toBeUndefined()

    ;(wrapper.vm as any).model.locked = true
    await nextTick()
    expect(loose.attributes('disabled')).toBeDefined()
    expect(field.attributes('disabled')).toBeDefined()
  })

  it('names a switch and a radio group the way each can be named', async () => {
    const rules: FormRules = { notify: { validator: value => value === true || 'Turn notifications on' } }
    const wrapper = mount({
      components,
      setup() {
        const model = reactive({ notify: false, plan: 'free' })
        const formRef = ref<any>(null)
        return { model, rules, formRef }
      },
      template: `
        <TxForm id="f" ref="formRef" :model="model" :rules="rules">
          <TxFormItem prop="notify" label="Notifications" required><TxSwitch v-model="model.notify" /></TxFormItem>
          <TxFormItem prop="plan" label="Plan">
            <TxRadioGroup v-model="model.plan" type="standard">
              <TxRadio value="free" label="Free" />
              <TxRadio value="pro" label="Pro" />
            </TxRadioGroup>
          </TxFormItem>
        </TxForm>
      `,
    })

    const labels = wrapper.findAll('label')
    const toggle = wrapper.find('.tuff-switch')
    // A button can carry a `<label for>`.
    expect(labels[0].attributes('for')).toBe('f-notify')
    expect(toggle.attributes('id')).toBe('f-notify')
    expect(toggle.attributes('aria-required')).toBe('true')

    // A radio group cannot, so it points at the label instead.
    await nextTick()
    const group = wrapper.find('[role="radiogroup"]')
    expect(labels[1].attributes('for')).toBeUndefined()
    expect(group.attributes('id')).toBe('f-plan')
    expect(group.attributes('aria-labelledby')).toBe('f-plan-label')

    expect(await (wrapper.vm as any).formRef.validate()).toBe(false)
    await nextTick()
    expect(toggle.attributes('aria-invalid')).toBe('true')
  })

  it('marks a select invalid and hides the item from the input inside it', async () => {
    const rules: FormRules = { lang: { required: true } }
    const wrapper = mount({
      components,
      setup() {
        const model = reactive({ lang: '' })
        const formRef = ref<any>(null)
        return { model, rules, formRef }
      },
      template: `
        <TxForm id="f" ref="formRef" :model="model" :rules="rules">
          <TxFormItem prop="lang" label="Language">
            <TxSelect v-model="model.lang">
              <TxSelectItem value="en" label="English" />
            </TxSelect>
          </TxFormItem>
        </TxForm>
      `,
    }, { global: { stubs: { TxPopover: PopoverStub } } })

    const inputs = wrapper.findAll('input')
    expect(inputs.filter(input => input.attributes('id') === 'f-lang')).toHaveLength(1)
    expect(wrapper.find('.tx-input').classes()).not.toContain('is-invalid')

    expect(await (wrapper.vm as any).formRef.validate()).toBe(false)
    await nextTick()
    expect(wrapper.find('.tuff-select').classes()).toContain('is-status-error')
    expect(wrapper.find('#f-lang').attributes('aria-invalid')).toBe('true')
  })
})

describe('txBlockSlot in a form', () => {
  it('joins the form with prop: the title names the control, a message replaces the description', async () => {
    const wrapper = mountForm(`
      <TxForm id="f" ref="formRef" :model="model">
        <TxBlockInput v-model="model.name" prop="name" title="Display name" description="Shown to others" required />
        <TxBlockInput v-model="model.email" title="Plain row" description="Not a field" />
      </TxForm>
    `)
    const [joined, plain] = wrapper.findAll('.tx-block-slot')
    const input = joined.find('input')
    expect(input.attributes('id')).toBe('f-name')
    expect(input.attributes('required')).toBeDefined()
    expect(joined.find('h5').attributes('id')).toBe(input.attributes('aria-labelledby'))
    expect(joined.find('.tx-block-slot__description').attributes('id')).toBe(input.attributes('aria-describedby'))
    expect(joined.find('.tx-block-slot__required').exists()).toBe(true)

    // Without prop the row stays as it was.
    const plainInput = plain.find('input')
    expect(plainInput.attributes('id')).toBeUndefined()
    expect(plainInput.attributes('aria-labelledby')).toBeUndefined()
    expect(plainInput.attributes('aria-describedby')).toBeUndefined()
    expect(plain.find('h5').attributes('id')).toBeUndefined()

    expect(await (wrapper.vm as any).formRef.validate()).toBe(false)
    await nextTick()
    const description = joined.find('.tx-block-slot__description')
    expect(description.classes()).toContain('tx-block-slot__description--error')
    expect(description.text()).toBe('Error: Display name is required')
    expect(joined.classes()).toContain('is-error')
    expect(input.attributes('aria-invalid')).toBe('true')

    await input.setValue('Ann')
    expect(joined.find('.tx-block-slot__description').text()).toBe('Shown to others')
  })
})
