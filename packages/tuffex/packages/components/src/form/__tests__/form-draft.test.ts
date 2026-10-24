import type { FormDraftAdapter, FormReconcileContext, TxFormHost } from '../src/types'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive, ref } from 'vue'
import TuffInput from '../../input/src/TxInput.vue'
import { TX_FORM_HOST_KEY } from '../src/context'
import { clearTxFormDrafts, decodeValue, draftKey, encodeValue, flushTxForms } from '../src/draft'
import TxForm from '../src/TxForm.vue'
import TxFormItem from '../src/TxFormItem.vue'

const components = { TxForm, TxFormItem, TuffInput }
const KEY = 'tx-form:default:profile'

/** Node's own `localStorage` shadows jsdom's and is empty without `--localstorage-file`. */
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

let localStorage: MemoryStorage

enableAutoUnmount(afterEach)

beforeEach(() => {
  localStorage = new MemoryStorage()
  Object.defineProperty(window, 'localStorage', { configurable: true, value: localStorage })
  Object.defineProperty(window, 'sessionStorage', { configurable: true, value: new MemoryStorage() })
})

afterEach(async () => {
  await clearTxFormDrafts()
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

function record(data: Record<string, { value: unknown, base: unknown }>, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ v: 1, savedAt: Date.now() - 1000, expiresAt: Date.now() + 864e5, data, ...extra })
}

function stored(key = KEY): Record<string, { value: unknown, base: unknown }> | null {
  const text = localStorage.getItem(key)
  return text === null ? null : JSON.parse(text).data
}

interface Setup {
  persist?: unknown
  leaveConfirm?: unknown
  reconcile?: unknown
  onSubmit?: unknown
}

function mountForm(setup: Setup = {}, host?: TxFormHost) {
  const model = ref<Record<string, any>>(reactive({ name: 'Ann', bio: '' }))
  const wrapper = mount({
    components,
    setup() {
      const formRef = ref<any>(null)
      return { model, formRef, persist: true, leaveConfirm: undefined, reconcile: undefined, onSubmit: undefined, ...setup }
    },
    template: `
      <TxForm
        id="profile"
        ref="formRef"
        :model="model"
        :persist="persist"
        :leave-confirm="leaveConfirm"
        :reconcile="reconcile"
        @submit="onSubmit"
      >
        <TxFormItem prop="name" label="Name">
          <TuffInput v-model="model.name" />
        </TxFormItem>
        <TxFormItem prop="bio" label="Bio">
          <TuffInput v-model="model.bio" />
        </TxFormItem>
      </TxForm>
    `,
  }, { attachTo: document.body, global: { provide: host ? { [TX_FORM_HOST_KEY as symbol]: host } : {} } })
  return {
    wrapper,
    model,
    form: () => (wrapper.vm as any).formRef,
    emitted: (event: string) => wrapper.findComponent(TxForm).emitted(event),
  }
}

function leaveEvent(): Event {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event
}

describe('txForm drafts', () => {
  it('writes the changed fields with the saved values they were edited from', async () => {
    const { model, form } = mountForm()
    await flushPromises()
    model.value.name = 'Bea'
    await nextTick()
    await form().flush()
    expect(stored()).toEqual({ name: { value: 'Bea', base: 'Ann' } })

    model.value.name = 'Ann'
    await nextTick()
    await form().flush()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('writes once typing pauses, or every two seconds of steady typing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const { model } = mountForm()
    await flushPromises()

    model.value.name = 'B'
    await nextTick()
    await vi.advanceTimersByTimeAsync(299)
    expect(stored()).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(stored()?.name?.value).toBe('B')

    for (let index = 0; index < 8; index++) {
      model.value.name = `C${index}`
      await nextTick()
      await vi.advanceTimersByTimeAsync(250)
    }
    // Keystrokes 250ms apart never pause long enough; the two-second cap wrote anyway.
    expect(stored()?.name?.value).toMatch(/^C[67]$/)
  })

  it('fills in a draft over the saved values and takes it back on discard', async () => {
    localStorage.setItem(KEY, record({ name: { value: 'Bea', base: 'Ann' } }))
    const { wrapper, model, form } = mountForm()
    await flushPromises()
    expect(model.value.name).toBe('Bea')
    expect(form().dirty).toBe(true)
    expect(form().draft.restored).toEqual(['name'])
    expect(wrapper.find('.tx-form__draft').text()).toContain('Restored unsaved changes from')
    // Nothing waits, so there is nothing to restore.
    expect(wrapper.findAll('.tx-form__draft-action').map(button => button.text())).toEqual(['Discard'])

    await wrapper.find('.tx-form__draft-action').trigger('click')
    await flushPromises()
    expect(model.value.name).toBe('Ann')
    expect(form().dirty).toBe(false)
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(wrapper.find('.tx-form__draft').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.find('input').element)
  })

  it('holds back a field that was saved again since the draft was written', async () => {
    localStorage.setItem(KEY, record({ name: { value: 'Bea', base: 'Old' } }))
    const { wrapper, model, form } = mountForm()
    await flushPromises()
    expect(model.value.name).toBe('Ann')
    expect(form().draft.pending).toEqual(['name'])
    expect(wrapper.find('.tx-form__draft').text()).toContain('You have unsaved changes from')
    // Still offered after a reload: it stays in the draft until the user decides.
    expect(stored()).toEqual({ name: { value: 'Bea', base: 'Old' } })

    await wrapper.findAll('.tx-form__draft-action')[0]!.trigger('click')
    await flushPromises()
    expect(model.value.name).toBe('Bea')
    expect(form().draft).toMatchObject({ pending: [], restored: ['name'] })
    await form().flush()
    expect(stored()).toEqual({ name: { value: 'Bea', base: 'Ann' } })
  })

  it('lets reconcile merge a draft with the values saved since', async () => {
    localStorage.setItem(KEY, record({ name: { value: 'Bea', base: 'Old' } }))
    const reconcile = vi.fn((context: FormReconcileContext) => ({ name: `${context.current.name}+${context.incoming.name}` }))
    const { model, form } = mountForm({ reconcile })
    await flushPromises()
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({
      source: 'draft',
      incoming: { name: 'Bea' },
      origin: { name: 'Old' },
      dirtyPaths: ['name'],
    }))
    expect(model.value.name).toBe('Ann+Bea')
    expect(form().draft).toMatchObject({ pending: [], restored: ['name'] })
  })

  it('leaves the draft in the notice when reconcile returns nothing', async () => {
    localStorage.setItem(KEY, record({ name: { value: 'Bea', base: 'Old' } }))
    const { model, form } = mountForm({ reconcile: () => {} })
    await flushPromises()
    expect(model.value.name).toBe('Ann')
    expect(form().draft.pending).toEqual(['name'])
  })

  it('waits for the notice with restore manual', async () => {
    localStorage.setItem(KEY, record({ name: { value: 'Bea', base: 'Ann' } }))
    const { model, form } = mountForm({ persist: { restore: 'manual' } })
    await flushPromises()
    expect(model.value.name).toBe('Ann')
    expect(form().draft.pending).toEqual(['name'])
    expect(await form().restoreDraft()).toBe(true)
    expect(model.value.name).toBe('Bea')
  })

  it('keeps what the user typed while the draft was being read', async () => {
    let answer!: (value: string | null) => void
    const adapter: FormDraftAdapter = {
      get: () => new Promise(resolve => (answer = resolve)),
      set: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    }
    const { model } = mountForm({ persist: { storage: adapter } })
    await flushPromises()
    model.value.name = 'Typed'
    await nextTick()
    answer(record({ name: { value: 'Bea', base: 'Ann' }, bio: { value: 'Hi', base: '' } }))
    await flushPromises()
    expect(model.value).toEqual({ name: 'Typed', bio: 'Hi' })
  })

  it('lays the draft back over a record fetched again', async () => {
    const { model, form } = mountForm()
    await flushPromises()
    model.value.name = 'Bea'
    await nextTick()
    await form().flush()

    // Someone else changed the bio meanwhile; the name is as it was.
    model.value = reactive({ name: 'Ann', bio: 'New' })
    await flushPromises()
    expect(model.value).toEqual({ name: 'Bea', bio: 'New' })
    expect(form().draft.restored).toEqual(['name'])
  })

  it('drops the draft once the values are saved or reset', async () => {
    const onSubmit = vi.fn()
    const { model, form } = mountForm({ onSubmit })
    await flushPromises()
    model.value.name = 'Bea'
    await nextTick()
    await form().flush()
    expect(stored()).not.toBeNull()

    expect(await form().submit()).toBe(true)
    await form().flush()
    expect(localStorage.getItem(KEY)).toBeNull()

    model.value.bio = 'Hi'
    await nextTick()
    await form().flush()
    expect(stored()).toEqual({ bio: { value: 'Hi', base: '' } })
    form().reset()
    await form().flush()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('drops a draft written under another version', async () => {
    localStorage.setItem(KEY, record({ name: { value: 'Bea', base: 'Ann' } }))
    const { model } = mountForm({ persist: { version: 2 } })
    await flushPromises()
    expect(model.value.name).toBe('Ann')
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('keeps each record apart and clears one namespace only', async () => {
    const { model, form } = mountForm({ persist: { recordId: 42, namespace: 'user' } })
    await flushPromises()
    model.value.name = 'Bea'
    await nextTick()
    await form().flush()
    expect(stored('tx-form:user:profile:42')).not.toBeNull()

    localStorage.setItem(draftKey('user:42', 'profile'), record({ name: { value: 'Cid', base: 'Ann' } }))
    await clearTxFormDrafts({ namespace: 'user' })
    expect(localStorage.getItem('tx-form:user:profile:42')).toBeNull()
    // `user:42` is another namespace, not one inside `user`.
    expect(localStorage.getItem(draftKey('user:42', 'profile'))).not.toBeNull()
  })

  it('clears every namespace a function picks', async () => {
    const { model, form } = mountForm({}, { namespace: 'user:1' })
    await flushPromises()
    model.value.bio = 'Hi'
    await nextTick()
    for (const owner of ['user:2', 'user:12', 'anon'])
      localStorage.setItem(draftKey(owner, 'profile'), record({ name: { value: 'Cid', base: 'Ann' } }))
    window.sessionStorage.setItem(draftKey('user:12', 'notes'), record({ bio: { value: 'Yo', base: '' } }))

    // At startup: every account's drafts but the one signed in.
    await clearTxFormDrafts({ namespace: owner => owner.startsWith('user:') && owner !== 'user:2' })
    // The form under `user:1` drops the write it was about to make.
    await form().flush()
    expect([localStorage.key(0), localStorage.key(1), localStorage.key(2)])
      .toEqual([draftKey('user:2', 'profile'), draftKey('anon', 'profile'), null])
    expect(window.sessionStorage.length).toBe(0)
  })

  it('picks namespaces in a custom store only through its keys', async () => {
    const items = new Map([[draftKey('user:1', 'profile'), '{}'], [draftKey('anon', 'profile'), '{}']])
    const listed: FormDraftAdapter = {
      get: key => items.get(key),
      set: (key, value) => {
        items.set(key, value)
      },
      remove: (key) => {
        items.delete(key)
      },
      keys: prefix => [...items.keys()].filter(key => key.startsWith(prefix)),
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const accounts = (owner: string): boolean => owner !== 'anon'

    await clearTxFormDrafts({ namespace: accounts, storage: { ...listed, keys: undefined } })
    expect(items.size).toBe(2)
    expect(warn).toHaveBeenCalledOnce()
    await clearTxFormDrafts({ namespace: accounts, storage: listed })
    expect([...items.keys()]).toEqual([draftKey('anon', 'profile')])
  })

  it('keeps no draft until the host knows whose it is', async () => {
    const namespace = ref<string | null>(null)
    localStorage.setItem(draftKey('user:7', 'profile'), record({ name: { value: 'Cid', base: 'Ann' } }))
    const { model, form } = mountForm({}, { namespace })
    await flushPromises()
    model.value.bio = 'Hi'
    await nextTick()
    await form().flush()
    expect(localStorage.length).toBe(1)
    expect(leaveEvent().defaultPrevented).toBe(true)

    namespace.value = 'user:7'
    await flushPromises()
    expect(model.value.name).toBe('Cid')
    await form().flush()
    expect(stored(draftKey('user:7', 'profile'))).toEqual({
      name: { value: 'Cid', base: 'Ann' },
      bio: { value: 'Hi', base: '' },
    })
  })

  it('writes nothing one person typed into the next one\'s draft', async () => {
    const namespace = ref<string | null>('user:1')
    const { model, form } = mountForm({}, { namespace })
    await flushPromises()
    model.value.bio = 'Hi'
    await nextTick()
    await form().flush()
    expect(stored(draftKey('user:1', 'profile'))).toEqual({ bio: { value: 'Hi', base: '' } })

    // Signing out with a write still waiting.
    model.value.bio = 'Hi there'
    await nextTick()
    namespace.value = 'anon'
    await clearTxFormDrafts({ namespace: 'user:1' })
    await flushPromises()
    await form().flush()
    expect(localStorage.length).toBe(0)
    expect(leaveEvent().defaultPrevented).toBe(true)

    model.value.name = 'Bea'
    await nextTick()
    await form().flush()
    expect(stored(draftKey('anon', 'profile'))).toEqual({ name: { value: 'Bea', base: 'Ann' } })

    model.value.bio = 'Hello'
    await nextTick()
    await form().flush()
    expect(stored(draftKey('anon', 'profile'))).toEqual({
      name: { value: 'Bea', base: 'Ann' },
      bio: { value: 'Hello', base: '' },
    })
    expect(localStorage.getItem(draftKey('user:1', 'profile'))).toBeNull()
  })

  it('keeps writes in memory when the store refuses them, and reports it once', async () => {
    const adapter: FormDraftAdapter = {
      get: () => null,
      set: () => {
        throw new Error('quota')
      },
      remove: () => {},
    }
    const first = mountForm({ persist: { storage: adapter } })
    await flushPromises()
    first.model.value.name = 'Bea'
    await nextTick()
    await first.form().flush()
    first.model.value.name = 'Cid'
    await nextTick()
    await first.form().flush()
    expect(first.emitted('persist-error')).toHaveLength(1)
    expect(first.form().draft.failed).toBe(true)
    // Nothing reached a store that outlives the page: leaving asks.
    expect(leaveEvent().defaultPrevented).toBe(true)
    first.wrapper.unmount()

    const second = mountForm({ persist: { storage: adapter } })
    await flushPromises()
    expect(second.model.value.name).toBe('Cid')
  })

  it('writes every pending draft at once through flushTxForms', async () => {
    const { model } = mountForm()
    await flushPromises()
    model.value.name = 'Bea'
    await nextTick()
    expect(stored()).toBeNull()
    await flushTxForms()
    expect(stored()?.name?.value).toBe('Bea')
  })

  it('warns and keeps nothing when persist has no id to store under', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const model = reactive({ name: 'Ann' })
    mount({
      components,
      setup: () => ({ model }),
      template: `<TxForm :model="model" persist><TxFormItem prop="name"><TuffInput v-model="model.name" /></TxFormItem></TxForm>`,
    })
    await flushPromises()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('`persist` stores the draft under the form\'s `id`'))
  })
})

describe('txForm secrets', () => {
  it('keeps secrets and opted-out fields out of the draft, and names them before leaving', async () => {
    const model = reactive({ name: 'Ann', password: '', code: '', note: '' })
    const leaveConfirm = vi.fn(() => false)
    const wrapper = mount({
      components,
      setup() {
        const formRef = ref<any>(null)
        return { model, formRef, leaveConfirm }
      },
      template: `
        <TxForm id="profile" ref="formRef" :model="model" persist :leave-confirm="leaveConfirm">
          <TxFormItem prop="name" label="Name"><TuffInput v-model="model.name" /></TxFormItem>
          <TxFormItem prop="password" label="Password"><TuffInput v-model="model.password" type="password" /></TxFormItem>
          <TxFormItem prop="code" label="Code"><TuffInput v-model="model.code" autocomplete="one-time-code" /></TxFormItem>
          <TxFormItem prop="note" label="Note" :persist="false"><TuffInput v-model="model.note" /></TxFormItem>
        </TxForm>
      `,
    }, { attachTo: document.body })
    await flushPromises()
    Object.assign(model, { name: 'Bea', password: 'hunter2', code: '123456', note: 'private' })
    await nextTick()
    const form = (wrapper.vm as any).formRef
    await form.flush()
    expect(stored()).toEqual({ name: { value: 'Bea', base: 'Ann' } })

    expect(await form.confirmLeave()).toBe(false)
    expect(leaveConfirm).toHaveBeenCalledWith({
      unsaved: [
        { path: 'password', label: 'Password' },
        { path: 'code', label: 'Code' },
        { path: 'note', label: 'Note' },
      ],
      persisted: true,
    })
    expect(leaveEvent().defaultPrevented).toBe(true)
  })
})

describe('txForm leaving', () => {
  it('asks through window.confirm when no draft keeps the changes', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    // Written as forms usually are, with no `leave-confirm` attribute: Vue must not read it as `false`.
    const model = reactive({ name: 'Ann' })
    const wrapper = mount({
      components,
      setup: () => ({ model, formRef: ref<any>(null) }),
      template: `<TxForm ref="formRef" :model="model"><TxFormItem prop="name"><TuffInput v-model="model.name" /></TxFormItem></TxForm>`,
    }, { attachTo: document.body })
    await flushPromises()
    expect(leaveEvent().defaultPrevented).toBe(false)

    model.name = 'Bea'
    await nextTick()
    expect(leaveEvent().defaultPrevented).toBe(true)
    expect(await (wrapper.vm as any).formRef.confirmLeave()).toBe(false)
    expect(confirm).toHaveBeenCalledWith('You have unsaved changes. Leave anyway?')
  })

  it('does not ask once the draft holds every change', async () => {
    const leaveConfirm = vi.fn(() => false)
    const { model, form } = mountForm({ leaveConfirm })
    await flushPromises()
    model.value.name = 'Bea'
    await nextTick()
    expect(await form().confirmLeave()).toBe(true)
    expect(leaveConfirm).not.toHaveBeenCalled()
    expect(leaveEvent().defaultPrevented).toBe(false)
  })

  it('never asks with leaveConfirm false', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const { model, form } = mountForm({ persist: false, leaveConfirm: false })
    await flushPromises()
    model.value.name = 'Bea'
    await nextTick()
    expect(leaveEvent().defaultPrevented).toBe(false)
    expect(await form().confirmLeave()).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('stays when leaveConfirm throws', async () => {
    const errorHandler = vi.fn()
    const model = reactive({ name: 'Ann' })
    const wrapper = mount({
      components,
      setup() {
        const formRef = ref<any>(null)
        const leaveConfirm = () => {
          throw new Error('broken')
        }
        return { model, formRef, leaveConfirm }
      },
      template: `<TxForm ref="formRef" :model="model" :leave-confirm="leaveConfirm"><TxFormItem prop="name"><TuffInput v-model="model.name" /></TxFormItem></TxForm>`,
    }, { global: { config: { errorHandler } } })
    model.name = 'Bea'
    await nextTick()
    expect(await (wrapper.vm as any).formRef.confirmLeave()).toBe(false)
    expect(errorHandler).toHaveBeenCalledWith(expect.objectContaining({ message: 'broken' }), expect.anything(), expect.any(String))
  })
})

describe('draft values', () => {
  it('round-trips what JSON alone would lose', () => {
    const value = { at: new Date(5), none: undefined, far: Number.POSITIVE_INFINITY, odd: Number.NaN, list: [undefined, 1], own: { '~': 'u' } }
    const decoded = decodeValue(JSON.parse(JSON.stringify(encodeValue(value)))) as typeof value
    expect(decoded.at).toEqual(new Date(5))
    expect('none' in decoded && decoded.none === undefined).toBe(true)
    expect(decoded.far).toBe(Number.POSITIVE_INFINITY)
    expect(decoded.odd).toBeNaN()
    expect(decoded.list).toEqual([undefined, 1])
    // An object of the model's own that uses the marker key stays an object.
    expect(decoded.own).toEqual({ '~': 'u' })
  })

  it('refuses values it cannot write back as they were', () => {
    expect(() => encodeValue(new File([], 'a.png'))).toThrow()
    expect(() => encodeValue({ nested: new Map() })).toThrow()
  })
})
