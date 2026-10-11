/**
 * The global shortcut that opens CoreBox, shared by the module that binds it and the surfaces
 * that print it (tray, sidebar, onboarding, the main window's command window). Written once so the
 * key a hint teaches cannot drift from the key that is bound.
 */
export const COREBOX_TOGGLE_SHORTCUT_ID = 'core.box.toggle'

/**
 * ⌥Space on macOS, Alt+Space elsewhere: the launcher convention (Raycast, PowerToys Run).
 *
 * No other key stands in when it cannot be had: CoreBox is then left without a key, and the user
 * is told once per launch. Windows refuses a key another app holds (PowerToys Run ships on
 * Alt+Space). macOS does not: Raycast or Alfred holding ⌥Space leaves Tuff's registration
 * succeeding, so nothing reports the overlap there.
 */
export const COREBOX_TOGGLE_DEFAULT_ACCELERATOR = 'Alt+Space'

/**
 * Earlier defaults. A system-authored binding still on one of these was never chosen by the user,
 * so it moves to the current default; any other value is the user's and is left alone.
 */
export const COREBOX_TOGGLE_LEGACY_DEFAULT_ACCELERATORS: readonly string[] = ['CommandOrControl+E']

export const COREBOX_DETACH_SHORTCUT_ID = 'core.box.detach'
export const COREBOX_DETACH_DEFAULT_ACCELERATOR = 'CommandOrControl+D'

export const COREBOX_TRANSFER_SHORTCUT_ID = 'core.box.transfer'
export const COREBOX_TRANSFER_DEFAULT_ACCELERATOR = 'CommandOrControl+Shift+D'

export interface CoreBoxFlowShortcutBindings {
  detach?: string | null
  transfer?: string | null
}

export interface CoreBoxShortcutKeyInput {
  key: string
  meta: boolean
  control: boolean
  alt: boolean
  shift: boolean
  isAutoRepeat?: boolean
}

export function matchesCoreBoxShortcutAccelerator(
  input: CoreBoxShortcutKeyInput,
  accelerator: string | null | undefined
): boolean {
  if (input.isAutoRepeat || !accelerator || typeof accelerator !== 'string') {
    return false
  }

  const tokens = accelerator
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean)

  if (!tokens.length) {
    return false
  }

  const keyToken = tokens[tokens.length - 1]
  const modifierTokens = tokens.slice(0, -1).map((token) => token.toLowerCase())

  const inputKey = input.key === ' ' ? 'space' : input.key.toLowerCase()
  const targetKey = keyToken.toLowerCase() === 'return' ? 'enter' : keyToken.toLowerCase()
  if (inputKey !== targetKey) {
    return false
  }

  const hasCmdOrCtrl =
    modifierTokens.includes('commandorcontrol') || modifierTokens.includes('cmdorctrl')
  const wantMeta =
    modifierTokens.includes('command') ||
    modifierTokens.includes('cmd') ||
    modifierTokens.includes('super') ||
    modifierTokens.includes('meta')
  const wantCtrl = modifierTokens.includes('control') || modifierTokens.includes('ctrl')
  const wantAlt =
    modifierTokens.includes('alt') ||
    modifierTokens.includes('option') ||
    modifierTokens.includes('opt')
  const wantShift = modifierTokens.includes('shift')

  if (Boolean(input.alt) !== wantAlt || Boolean(input.shift) !== wantShift) {
    return false
  }

  if (hasCmdOrCtrl) {
    if (!input.meta && !input.control) {
      return false
    }
    if (wantMeta && !input.meta) {
      return false
    }
    if (wantCtrl && !input.control) {
      return false
    }
    return true
  }

  return Boolean(input.meta) === wantMeta && Boolean(input.control) === wantCtrl
}

export function resolveCoreBoxFlowShortcutFromBindings(
  input: CoreBoxShortcutKeyInput,
  bindings?: CoreBoxFlowShortcutBindings
): 'detach' | 'transfer' | null {
  const detachAccelerator =
    bindings?.detach !== undefined ? bindings.detach : COREBOX_DETACH_DEFAULT_ACCELERATOR
  const transferAccelerator =
    bindings?.transfer !== undefined ? bindings.transfer : COREBOX_TRANSFER_DEFAULT_ACCELERATOR

  if (matchesCoreBoxShortcutAccelerator(input, transferAccelerator)) {
    return 'transfer'
  }
  if (matchesCoreBoxShortcutAccelerator(input, detachAccelerator)) {
    return 'detach'
  }
  return null
}
