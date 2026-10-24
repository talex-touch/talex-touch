import type { FormReconcileContext, FormRules, FormStandardSchema } from '../src/types'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive, ref } from 'vue'
import TuffInput from '../../input/src/TxInput.vue'
import TxForm from '../src/TxForm.vue'
import TxFormErrorSummary from '../src/TxFormErrorSummary.vue'
import TxFormItem from '../src/TxFormItem.vue'

const components = { TxForm, TxFormItem, TxFormErrorSummary, TuffInput }

function messageText(wrapper: { find: (selector: string) => { exists: () => boolean, text: () => string } }, item = '.tx-form-item'): string | null {
  const text = wrapper.find(`${item} .tx-form-item__message-text`)
  return text.exists() ? text.text() : null
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('txForm validation', () => {
  it('validates a nested path and ids the control by the form id and path', async () => {
    const wrapper = mount({
      components,
      setup() {
        const model = reactive({ profile: { email: '' } })
        const rules: FormRules = { 'profile.email': [{ required: true }, { type: 'email' }] }
        const formRef = ref<any>(null)
        return { model, rules, formRef }
      },
      template: `
        <TxForm id="account" ref="formRef" :model="model" :rules="rules">
          <TxFormItem prop="profile.email" label="Email">
            <TuffInput v-model="model.profile.email" />
          </TxFormItem>
        </TxForm>
      `,
    })

    const input = wrapper.find('input')
    expect(input.attributes('id')).toBe('account-profile-email')
    expect(wrapper.find('label').attributes('for')).toBe('account-profile-email')

    const form = (wrapper.vm as any).formRef
    expect(await form.validate()).toBe(false)
    expect(messageText(wrapper)).toBe('Email is required')

    // A field that has shown a message follows every edit.
    await input.setValue('nope')
    expect(messageText(wrapper)).toBe('Email must be an email address')

    await input.setValue('ann@example.com')
    expect(messageText(wrapper)).toBeNull()
    expect(form.valid).toBe(true)
  })

  it('shows a message only once focus leaves the field changed', async () => {
    const wrapper = mount({
      components,
      setup() {
        const model = reactive({ name: '' })
        const rules: FormRules = { name: { minLength: 3 } }
        return { model, rules }
      },
      template: `
        <TxForm :model="model" :rules="rules">
          <TxFormItem prop="name" label="Name">
            <TuffInput v-model="model.name" />
          </TxFormItem>
          <button type="button" class="outside">Elsewhere</button>
        </TxForm>
      `,
    }, { attachTo: document.body })

    const input = wrapper.find('input')
    const outside = wrapper.find('.outside')

    // Passing through without a change says nothing.
    input.element.focus()
    ;(outside.element as HTMLElement).focus()
    await nextTick()
    expect(messageText(wrapper)).toBeNull()

    input.element.focus()
    await input.setValue('ab')
    expect(messageText(wrapper)).toBeNull()

    ;(outside.element as HTMLElement).focus()
    await nextTick()
    expect(messageText(wrapper)).toBe('Name needs at least 3 characters')

    await input.setValue('abc')
    expect(messageText(wrapper)).toBeNull()
    wrapper.unmount()
  })

  it('holds the message back while the press that left the field is down', async () => {
    vi.useFakeTimers()
    const wrapper = mount({
      components,
      setup() {
        const model = reactive({ name: '' })
        const rules: FormRules = { name: { minLength: 3 } }
        return { model, rules }
      },
      template: `
        <TxForm :model="model" :rules="rules">
          <TxFormItem prop="name" label="Name">
            <TuffInput v-model="model.name" />
          </TxFormItem>
          <button type="button" class="below">Below</button>
        </TxForm>
      `,
    }, { attachTo: document.body })

    const input = wrapper.find('input')
    const below = wrapper.find('.below').element as HTMLElement
    input.element.focus()
    await input.setValue('ab')

    // A message opening now would move the button out from under the release.
    below.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    below.focus()
    await nextTick()
    expect(messageText(wrapper)).toBeNull()

    // The click comes after the release, in the same task.
    below.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))
    await nextTick()
    expect(messageText(wrapper)).toBeNull()

    vi.runAllTimers()
    await nextTick()
    expect(messageText(wrapper)).toBe('Name needs at least 3 characters')
    wrapper.unmount()
  })

  it('shows nothing held back once the click it waited for resets the form', async () => {
    vi.useFakeTimers()
    const wrapper = mount({
      components,
      setup() {
        const model = reactive({ name: '' })
        const rules: FormRules = { name: { minLength: 3 } }
        const formRef = ref<any>(null)
        return { model, rules, formRef }
      },
      template: `
        <TxForm ref="formRef" :model="model" :rules="rules">
          <TxFormItem prop="name" label="Name">
            <TuffInput v-model="model.name" />
          </TxFormItem>
          <button type="button" class="reset" @click="formRef.reset()">Reset</button>
        </TxForm>
      `,
    }, { attachTo: document.body })

    const input = wrapper.find('input')
    const reset = wrapper.find('.reset').element as HTMLElement
    input.element.focus()
    await input.setValue('ab')

    reset.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    reset.focus()
    reset.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))
    reset.click()
    vi.runAllTimers()
    await nextTick()
    expect((wrapper.vm as any).model.name).toBe('')
    expect(messageText(wrapper)).toBeNull()
    wrapper.unmount()
  })

  it('does not count switching to another window as leaving the field', async () => {
    const wrapper = mount({
      components,
      setup() {
        const model = reactive({ name: '' })
        const rules: FormRules = { name: { minLength: 3 } }
        return { model, rules }
      },
      template: `
        <TxForm :model="model" :rules="rules">
          <TxFormItem prop="name" label="Name">
            <TuffInput v-model="model.name" />
          </TxFormItem>
        </TxForm>
      `,
    }, { attachTo: document.body })

    const input = wrapper.find('input')
    input.element.focus()
    await input.setValue('ab')

    // The window loses focus, but the field stays the active element.
    input.element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    await nextTick()
    expect(messageText(wrapper)).toBeNull()
    wrapper.unmount()
  })

  it('waits for the first submit with validateOn submit', async () => {
    const wrapper = mount({
      components,
      setup() {
        const model = reactive({ name: '' })
        const rules: FormRules = { name: { minLength: 3 } }
        const formRef = ref<any>(null)
        return { model, rules, formRef }
      },
      template: `
        <TxForm ref="formRef" :model="model" :rules="rules" validate-on="submit">
          <TxFormItem prop="name" label="Name">
            <TuffInput v-model="model.name" />
          </TxFormItem>
          <button type="button" class="outside">Elsewhere</button>
        </TxForm>
      `,
    }, { attachTo: document.body })

    const input = wrapper.find('input')
    input.element.focus()
    await input.setValue('ab')
    ;(wrapper.find('.outside').element as HTMLElement).focus()
    await nextTick()
    expect(messageText(wrapper)).toBeNull()

    expect(await (wrapper.vm as any).formRef.submit()).toBe(false)
    await nextTick()
    expect(messageText(wrapper)).toBe('Name needs at least 3 characters')
    wrapper.unmount()
  })

  it('runs an async rule after the sync rules pass, and aborts a run the value has left', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const signals: AbortSignal[] = []
    const answers: Array<(result: boolean | string) => void> = []
    const rules: FormRules = {
      name: [
        { required: true },
        {
          validator: async (_value, _rule, _model, { signal }) => {
            signals.push(signal)
            return new Promise<boolean | string>(resolve => answers.push(resolve))
          },
        },
      ],
    }
    const wrapper = mount({
      components,
      setup() {
        const model = reactive({ name: '' })
        const formRef = ref<any>(null)
        return { model, rules, formRef }
      },
      template: `
        <TxForm ref="formRef" :model="model" :rules="rules">
          <TxFormItem prop="name" label="Name">
            <TuffInput v-model="model.name" />
          </TxFormItem>
        </TxForm>
      `,
    })

    const form = (wrapper.vm as any).formRef
    expect(await form.validate()).toBe(false)
    expect(signals).toHaveLength(0)

    const input = wrapper.find('input')
    await input.setValue('taken')
    await vi.advanceTimersByTimeAsync(300)
    expect(signals).toHaveLength(1)

    await input.setValue('taken2')
    expect(signals[0].aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(300)
    expect(signals).toHaveLength(2)

    // A slow check says so under the field and through the live region.
    await vi.advanceTimersByTimeAsync(1000)
    await nextTick()
    expect(wrapper.find('.tx-form-item__validating').exists()).toBe(true)
    expect(wrapper.find('.tx-form__status').text()).toBe('Validating…')

    answers[1]('Name is taken')
    answers[0](true)
    await flushPromises()
    expect(messageText(wrapper)).toBe('Name is taken')
    expect(form.valid).toBe(false)
  })

  it('shows server errors without blocking, and clears them on edit', async () => {
    const wrapper = mount({
      components,
      setup() {
        const model = reactive({ name: 'Ann' })
        const formRef = ref<any>(null)
        return { model, formRef }
      },
      template: `
        <TxForm ref="formRef" :model="model">
          <TxFormItem prop="name" label="Name">
            <TuffInput v-model="model.name" />
          </TxFormItem>
        </TxForm>
      `,
    })

    const form = (wrapper.vm as any).formRef
    form.setErrors({ name: 'Already taken' })
    await nextTick()
    expect(messageText(wrapper)).toBe('Already taken')
    expect(wrapper.find('input').attributes('aria-invalid')).toBe('true')
    expect(form.valid).toBe(true)

    await wrapper.find('input').setValue('Bea')
    expect(messageText(wrapper)).toBeNull()

    form.setErrors({ name: 'Not allowed here' }, { source: 'client' })
    await nextTick()
    expect(form.valid).toBe(false)
    expect(await form.validate()).toBe(false)
  })

  it('keeps errors for fields not shown yet until their item mounts', async () => {
    const wrapper = mount({
      components,
      setup() {
        const model = reactive({ address: { city: '' } })
        const showCity = ref(false)
        const formRef = ref<any>(null)
        return { model, showCity, formRef }
      },
      template: `
        <TxForm ref="formRef" :model="model">
          <TxFormItem v-if="showCity" prop="address.city" label="City">
            <TuffInput v-model="model.address.city" />
          </TxFormItem>
        </TxForm>
      `,
    })

    const vm = wrapper.vm as any
    vm.formRef.setErrors({ 'address.city': 'Unknown city' })
    await nextTick()
    expect(vm.formRef.errors).toEqual({ 'address.city': 'Unknown city' })
    expect(vm.formRef.valid).toBe(true)

    vm.showCity = true
    await nextTick()
    expect(messageText(wrapper)).toBe('Unknown city')

    vm.formRef.setErrors({ ghost: 'No field shows this' }, { source: 'client' })
    await nextTick()
    expect(vm.formRef.valid).toBe(false)
  })

  it('attributes Standard Schema issues to the item showing their path', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const schema: FormStandardSchema = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value: any) => value.age >= 18
          ? { value }
          : { issues: [{ message: 'Must be an adult', path: ['age'] }, { message: 'Terms must be accepted', path: ['terms'] }] },
      },
    }
    const wrapper = mount({
      components,
      setup() {
        const model = reactive({ age: 12 })
        const formRef = ref<any>(null)
        return { model, schema, formRef }
      },
      template: `
        <TxForm ref="formRef" :model="model" :schema="schema">
          <TxFormItem prop="age" label="Age">
            <TuffInput v-model.number="model.age" type="number" />
          </TxFormItem>
        </TxForm>
      `,
    })

    const form = (wrapper.vm as any).formRef
    expect(await form.validate()).toBe(false)
    expect(messageText(wrapper)).toBe('Must be an adult')
    // An issue no item shows still blocks, and is listed.
    expect(form.errors.terms).toBe('Terms must be accepted')

    ;(wrapper.vm as any).model.age = 30
    await nextTick()
    expect(form.valid).toBe(true)
  })
})

describe('txForm state', () => {
  it('awaits onSubmit and moves the baseline to what was sent', async () => {
    const sent: any[] = []
    let outcome: 'resolve' | 'false' | 'report' | 'throw' = 'resolve'
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = mount({
      components,
      setup() {
        const model = reactive({ name: 'Ann' })
        const formRef = ref<any>(null)
        async function save(values: any) {
          sent.push(values)
          // The handler's copy is its own.
          values.name = 'trimmed for the request'
          if (outcome === 'false')
            return false
          if (outcome === 'report')
            formRef.value.setErrors({ name: 'Taken' })
          if (outcome === 'throw')
            throw new Error('offline')
        }
        return { model, formRef, save }
      },
      template: `
        <TxForm ref="formRef" :model="model" @submit="save">
          <TxFormItem prop="name" label="Name">
            <TuffInput v-model="model.name" />
          </TxFormItem>
        </TxForm>
      `,
    })

    const vm = wrapper.vm as any
    await wrapper.find('input').setValue('Bea')
    expect(vm.formRef.dirty).toBe(true)

    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual({ name: 'trimmed for the request' })
    expect(vm.model.name).toBe('Bea')
    expect(vm.formRef.dirty).toBe(false)

    await wrapper.find('input').setValue('Cid')
    outcome = 'false'
    expect(await vm.formRef.submit()).toBe(false)
    expect(vm.formRef.dirty).toBe(true)

    outcome = 'report'
    expect(await vm.formRef.submit()).toBe(false)
    await nextTick()
    expect(messageText(wrapper)).toBe('Taken')

    outcome = 'throw'
    expect(await vm.formRef.submit()).toBe(false)
    expect(vm.formRef.submitting).toBe(false)
  })

  it('keeps fields the user changed when fetched values arrive', async () => {
    const wrapper = mount({
      components,
      setup() {
        const model = reactive({ name: 'Ann', bio: 'Old' })
        const formRef = ref<any>(null)
        return { model, formRef }
      },
      template: `
        <TxForm ref="formRef" :model="model">
          <TxFormItem prop="name" label="Name"><TuffInput v-model="model.name" /></TxFormItem>
          <TxFormItem prop="bio" label="Bio"><TuffInput v-model="model.bio" /></TxFormItem>
        </TxForm>
      `,
    })

    const vm = wrapper.vm as any
    vm.model.name = 'Ann B'
    await nextTick()

    vm.formRef.setBaseline({ name: 'Server Ann', bio: 'New bio' })
    await nextTick()
    expect(vm.model).toEqual({ name: 'Ann B', bio: 'New bio' })
    expect(vm.formRef.dirty).toBe(true)

    // Reset goes back to what arrived, not to what the edits were made against.
    vm.formRef.reset()
    await nextTick()
    expect(vm.model).toEqual({ name: 'Server Ann', bio: 'New bio' })
    expect(vm.formRef.dirty).toBe(false)
  })

  it('hands conflicts to reconcile, and only conflicts', async () => {
    const reconcile = vi.fn((context: FormReconcileContext) => context.incoming)
    const wrapper = mount({
      components,
      setup() {
        const model = reactive({ name: 'Ann', bio: 'Old' })
        const formRef = ref<any>(null)
        return { model, formRef, reconcile }
      },
      template: `
        <TxForm ref="formRef" :model="model" :reconcile="reconcile">
          <TxFormItem prop="name" label="Name"><TuffInput v-model="model.name" /></TxFormItem>
          <TxFormItem prop="bio" label="Bio"><TuffInput v-model="model.bio" /></TxFormItem>
        </TxForm>
      `,
    })

    const vm = wrapper.vm as any
    vm.formRef.setBaseline({ bio: 'Fetched' })
    expect(reconcile).not.toHaveBeenCalled()
    expect(vm.model).toEqual({ name: 'Ann', bio: 'Fetched' })

    vm.model.name = 'Edited'
    await nextTick()
    vm.formRef.setBaseline({ name: 'Server', bio: 'Fetched again' })
    expect(reconcile).toHaveBeenCalledOnce()
    expect(reconcile.mock.calls[0][0]).toMatchObject({
      source: 'baseline',
      dirtyPaths: ['name'],
      current: { name: 'Edited', bio: 'Fetched' },
      merged: { name: 'Edited', bio: 'Fetched again' },
    })
    // This host lets the server win.
    expect(vm.model).toEqual({ name: 'Server', bio: 'Fetched again' })
    expect(vm.formRef.dirty).toBe(false)
  })

  it('lists errors in the summary, focuses it on a failed submit, and links to each field', async () => {
    const wrapper = mount({
      components,
      setup() {
        const model = reactive({ name: '', email: '' })
        const rules: FormRules = { name: { required: true }, email: { required: true } }
        const formRef = ref<any>(null)
        return { model, rules, formRef }
      },
      template: `
        <TxForm id="signup" ref="formRef" :model="model" :rules="rules">
          <TxFormErrorSummary />
          <TxFormItem prop="name" label="Name"><TuffInput v-model="model.name" /></TxFormItem>
          <TxFormItem prop="email" label="Email"><TuffInput v-model="model.email" /></TxFormItem>
        </TxForm>
      `,
    }, { attachTo: document.body })

    const vm = wrapper.vm as any
    expect(wrapper.find('.tx-form-error-summary').exists()).toBe(false)

    expect(await vm.formRef.submit()).toBe(false)
    await nextTick()
    const summary = wrapper.find('.tx-form-error-summary')
    expect(document.activeElement).toBe(summary.element)
    const links = summary.findAll('a')
    expect(links.map(link => link.text())).toEqual(['Name is required', 'Email is required'])
    expect(links[1].attributes('href')).toBe('#signup-email')

    await links[1].trigger('click')
    expect(document.activeElement?.id).toBe('signup-email')

    // The summary shows the root error, so the form does not repeat it.
    vm.formRef.setRootError('The server is not reachable')
    await nextTick()
    expect(summary.find('.tx-form-error-summary__root').text()).toBe('The server is not reachable')
    expect(wrapper.find('.tx-form__root-error').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows a root error itself when no summary is mounted', async () => {
    const wrapper = mount({
      components,
      setup() {
        const model = reactive({ name: '' })
        const formRef = ref<any>(null)
        return { model, formRef }
      },
      template: `
        <TxForm ref="formRef" :model="model">
          <TxFormItem prop="name" label="Name"><TuffInput v-model="model.name" /></TxFormItem>
        </TxForm>
      `,
    })

    const vm = wrapper.vm as any
    vm.formRef.setRootError('The server is not reachable')
    await nextTick()
    const error = wrapper.find('.tx-form__root-error')
    expect(error.attributes('role')).toBe('alert')
    expect(error.text()).toBe('The server is not reachable')

    vm.formRef.reset()
    await nextTick()
    expect(wrapper.find('.tx-form__root-error').exists()).toBe(false)
  })
})
