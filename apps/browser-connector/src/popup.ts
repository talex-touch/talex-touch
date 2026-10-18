import { chromeApi } from './chrome'

interface ConnectorStatus {
  ok: boolean
  profileId?: string
  label?: string
  status?: 'disabled' | 'paused' | 'connected' | 'connecting' | 'offline'
  errorCode?: string | null
  detail?: string | null
  lastSyncedAt?: number | null
}
const connection = document.getElementById('connection')!
const status = document.getElementById('status')!
const profile = document.getElementById('profile')!
const synced = document.getElementById('synced')!
const error = document.getElementById('error')!
const pause = document.getElementById('pause') as HTMLButtonElement
const reconnect = document.getElementById('reconnect') as HTMLButtonElement
const disconnect = document.getElementById('disconnect') as HTMLButtonElement
const pairButton = document.getElementById('pairButton') as HTMLButtonElement
const label = document.getElementById('label') as HTMLInputElement
const code = document.getElementById('code') as HTMLInputElement
const form = document.getElementById('pair') as HTMLFormElement
let currentStatus: ConnectorStatus['status'] = 'offline'
let busy = false
let loaded = false

for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]'))
  element.textContent = chromeApi.i18n.getMessage(element.dataset.i18n!)
document.documentElement.lang = chromeApi.i18n.getUILanguage()
document.title = chromeApi.i18n.getMessage('appName')
label.value = chromeApi.i18n.getMessage('defaultProfileName')

function setBusy(value: boolean): void {
  busy = value
  pause.disabled = value || !loaded || currentStatus === 'disabled'
  disconnect.disabled = value || !loaded || currentStatus === 'disabled'
  reconnect.disabled = value || !loaded
  pairButton.disabled = value || !loaded
  connection.setAttribute('aria-busy', String(value))
}
function showError(key: string, detail?: string | null): void {
  const known = chromeApi.i18n.getMessage(key)
  error.textContent = `${known || chromeApi.i18n.getMessage('connectionFailed')}${detail ? `\n${detail}` : ''}`
  error.hidden = false
}
function statusRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function parseStatus(value: unknown): ConnectorStatus {
  if (!statusRecord(value) || typeof value.ok !== 'boolean')
    throw new Error('invalidMessage')
  if (
    'status' in value
    && value.status !== undefined
    && (typeof value.status !== 'string'
      || !['disabled', 'paused', 'connected', 'connecting', 'offline'].includes(value.status))
  ) {
    throw new Error('invalidMessage')
  }
  for (const key of ['profileId', 'label', 'errorCode', 'detail'] as const) {
    if (key in value && value[key] !== null && value[key] !== undefined && typeof value[key] !== 'string')
      throw new Error('invalidMessage')
  }
  if (
    'lastSyncedAt' in value
    && value.lastSyncedAt !== null
    && value.lastSyncedAt !== undefined
    && typeof value.lastSyncedAt !== 'number'
  ) {
    throw new Error('invalidMessage')
  }
  // The own-extension reply is checked above before adopting its optional display fields.
  return {
    ok: value.ok,
    profileId: typeof value.profileId === 'string' ? value.profileId : undefined,
    label: typeof value.label === 'string' ? value.label : undefined,
    status: value.status as ConnectorStatus['status'],
    errorCode: typeof value.errorCode === 'string' ? value.errorCode : null,
    detail: typeof value.detail === 'string' ? value.detail : null,
    lastSyncedAt: typeof value.lastSyncedAt === 'number' ? value.lastSyncedAt : null,
  }
}
async function update(message: unknown = { action: 'status' }): Promise<void> {
  const result = parseStatus(await chromeApi.runtime.sendMessage(message))
  loaded = true
  connection.setAttribute('aria-busy', 'false')
  if (!result.ok) {
    showError(result.errorCode ?? 'connectionFailed', result.detail)
    return
  }
  currentStatus = result.status ?? 'offline'
  status.textContent = chromeApi.i18n.getMessage(currentStatus)
  profile.textContent = result.label ?? chromeApi.i18n.getMessage('defaultProfileName')
  profile.title = result.profileId ?? ''
  synced.textContent = result.lastSyncedAt
    ? new Date(result.lastSyncedAt).toLocaleTimeString()
    : chromeApi.i18n.getMessage('notSynced')
  pause.textContent = chromeApi.i18n.getMessage(currentStatus === 'paused' ? 'resume' : 'pause')
  if (result.errorCode)
    showError(result.errorCode, result.detail)
  else error.hidden = true
  if (!busy)
    setBusy(false)
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  code.value = code.value.trim()
  if (busy || !form.reportValidity())
    return
  setBusy(true)
  try {
    // Must be requested directly from the user gesture, before any unrelated await.
    const granted = await chromeApi.permissions.request({ permissions: ['bookmarks', 'tabs'] })
    if (!granted) {
      showError('permissionsRequired')
      return
    }
    await update({ action: 'pair', code: code.value, label: label.value })
    code.value = ''
  }
  catch (failure) {
    showError('connectionFailed', failure instanceof Error ? failure.message : null)
  }
  finally {
    setBusy(false)
  }
})

pause.addEventListener('click', async () => {
  if (busy)
    return
  const action = currentStatus === 'paused' ? 'resume' : 'pause'
  setBusy(true)
  try {
    if (action === 'resume' && !(await chromeApi.permissions.request({ permissions: ['bookmarks', 'tabs'] }))) {
      showError('permissionsRequired')
      return
    }
    await update({ action })
  }
  catch (failure) {
    showError('connectionFailed', failure instanceof Error ? failure.message : null)
  }
  finally {
    setBusy(false)
  }
})
reconnect.addEventListener('click', async () => {
  if (busy)
    return
  setBusy(true)
  try {
    if (!(await chromeApi.permissions.request({ permissions: ['bookmarks', 'tabs'] }))) {
      showError('permissionsRequired')
      return
    }
    await update({ action: 'reconnect' })
  }
  catch (failure) {
    showError('connectionFailed', failure instanceof Error ? failure.message : null)
  }
  finally {
    setBusy(false)
  }
})
disconnect.addEventListener('click', async () => {
  if (busy)
    return
  setBusy(true)
  code.value = ''
  try {
    await update({ action: 'disconnect' })
  }
  catch (failure) {
    showError('connectionFailed', failure instanceof Error ? failure.message : null)
  }
  finally {
    setBusy(false)
  }
})

void update().catch((failure) => {
  loaded = true
  setBusy(false)
  showError('connectionFailed', failure instanceof Error ? failure.message : null)
})
const poll = setInterval(() => {
  if (!busy)
    void update().catch(() => showError('connectionFailed'))
}, 1000)
window.addEventListener('pagehide', () => clearInterval(poll), { once: true })
