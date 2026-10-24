import type { CSSProperties, Ref } from 'vue'
import type { ImagePreviewAction } from './types'
import type { PreviewBox, PreviewPoint } from './zoom'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef } from 'vue'
import { hasDocument } from '../../../../utils/env'
import { useVibrate } from '../../../../utils/vibrate'

// The menu: a long press on the picture, a right-click, or the context-menu key. The preview
// draws its own rather than using TxContextMenu, which teleports to <body>: there it would sit
// under the preview, outside its focus trap, and answer Escape alongside it.

export type PreviewMenuKind = 'touch' | 'pointer' | 'keyboard'

const MENU_MARGIN = 8
/** A finger's menu opens this far above it (px), clear of the fingertip. */
const MENU_FINGER_GAP = 16

export interface PreviewMenuOptions {
  /** The host asked for the menu. */
  enabled: () => boolean
  /** The preview is up and not leaving. */
  live: () => boolean
  overlay: Readonly<Ref<HTMLElement | null>>
  actions: () => readonly ImagePreviewAction[]
  disabled: (action: ImagePreviewAction) => boolean
  run: (action: ImagePreviewAction, reverse: boolean) => void
  /** Where the picture is fitted, in the overlay's pixels: the keyboard opens the menu on it. */
  fitBox: () => PreviewBox
  isPicture: (target: EventTarget | null) => boolean
  /** A point in the overlay's pixels. */
  point: (event: { clientX: number, clientY: number }) => PreviewPoint
  /** Lands a picture still flying out. */
  settle: () => void
  /** Ends the press the gestures hold. */
  endPress: () => void
  /** A fade of the preview's own transition. */
  level: (shown: () => boolean, ms: number) => Ref<number>
}

export interface PreviewMenu {
  menuOpen: Readonly<Ref<boolean>>
  /** Takes the pointer, once the press that opened it is let go. */
  menuArmed: Readonly<Ref<boolean>>
  /** Placed, and so shown. */
  menuPlaced: Readonly<Ref<boolean>>
  menuRef: Ref<HTMLElement | null>
  menuStyle: Readonly<Ref<CSSProperties>>
  menuLevel: Readonly<Ref<number>>
  /**
   * Opens the menu at `point`, in the overlay's pixels. `waitForRelease` keeps it from taking the
   * press that opened it: it takes the pointer only once that press is let go.
   */
  openMenu: (point: PreviewPoint, kind: PreviewMenuKind, waitForRelease: boolean) => boolean
  /** Closes it, putting focus back where it was when `restore`, or when the menu held it. */
  closeMenu: (restore: boolean) => void
  chooseFromMenu: (action: ImagePreviewAction, reverse: boolean) => void
  openMenuFromKeyboard: () => boolean
  onContextMenu: (event: MouseEvent) => void
  onMouseDown: (event: MouseEvent) => void
  onMenuKey: (event: KeyboardEvent) => void
}

export function usePreviewMenu(options: PreviewMenuOptions): PreviewMenu {
  const menuOpen = ref(false)
  const menuArmed = ref(false)
  const menuPlaced = ref(false)
  const menuRef = ref<HTMLElement | null>(null)
  const menuPlace = shallowRef({ left: 0, top: 0, originX: 0, originY: 0 })
  const menuLevel = options.level(() => menuOpen.value, 150)
  let menuAnchor: PreviewPoint & { kind: PreviewMenuKind } = { x: 0, y: 0, kind: 'pointer' }
  let menuReturnFocus: HTMLElement | null = null
  let releaseWait: (() => void) | null = null
  let armTimer: ReturnType<typeof setTimeout> | undefined

  const menuStyle = computed<CSSProperties>(() => {
    const place = menuPlace.value
    return {
      left: `${place.left}px`,
      top: `${place.top}px`,
      transformOrigin: `${place.originX}px ${place.originY}px`,
    }
  })

  function stopWaiting(): void {
    if (releaseWait && hasDocument()) {
      window.removeEventListener('pointerup', releaseWait, true)
      window.removeEventListener('pointercancel', releaseWait, true)
    }
    releaseWait = null
    if (armTimer !== undefined)
      clearTimeout(armTimer)
    armTimer = undefined
  }

  function menuItems(): HTMLElement[] {
    return Array.from(menuRef.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
  }

  function focusMenuItem(at: number): void {
    const list = menuItems()
    if (!menuOpen.value || list.length === 0)
      return
    list[((at % list.length) + list.length) % list.length]!.focus({ preventScroll: true })
  }

  function openMenu(point: PreviewPoint, kind: PreviewMenuKind, waitForRelease: boolean): boolean {
    if (!options.enabled() || !options.live() || !options.actions().some(action => !options.disabled(action)))
      return false
    options.settle()
    stopWaiting()
    if (kind === 'touch')
      useVibrate('light', { silent: true })
    if (!menuOpen.value) {
      const active = hasDocument() ? document.activeElement : null
      menuReturnFocus = active instanceof HTMLElement && options.overlay.value?.contains(active) ? active : null
    }
    menuAnchor = { x: point.x, y: point.y, kind }
    menuOpen.value = true
    menuArmed.value = false
    menuPlaced.value = false
    if (waitForRelease && hasDocument()) {
      const release = (): void => {
        stopWaiting()
        // After the release's own click, which would otherwise land on the menu.
        armTimer = setTimeout(() => {
          armTimer = undefined
          if (menuOpen.value)
            menuArmed.value = true
        }, 0)
      }
      releaseWait = release
      window.addEventListener('pointerup', release, true)
      window.addEventListener('pointercancel', release, true)
    }
    else {
      menuArmed.value = true
    }
    nextTick(placeMenu)
    return true
  }

  /** Over a finger, above it; at a pointer, beside it, turned back from the edges; from the keyboard, on the picture. */
  function placeMenu(): void {
    const menu = menuRef.value
    const root = options.overlay.value
    if (!menu || !root || !menuOpen.value)
      return
    const width = menu.offsetWidth
    const height = menu.offsetHeight
    const roomX = root.clientWidth
    const roomY = root.clientHeight
    const { x, y, kind } = menuAnchor
    let left = x
    let top = y
    if (kind === 'touch') {
      left = x - width / 2
      top = y - MENU_FINGER_GAP - height
      if (top < MENU_MARGIN)
        top = y + MENU_FINGER_GAP
    }
    else if (kind === 'pointer') {
      if (x + width > roomX - MENU_MARGIN)
        left = x - width
      if (y + height > roomY - MENU_MARGIN)
        top = y - height
    }
    else {
      left = x - width / 2
      top = y - height / 2
    }
    left = Math.max(MENU_MARGIN, Math.min(left, roomX - MENU_MARGIN - width))
    top = Math.max(MENU_MARGIN, Math.min(top, roomY - MENU_MARGIN - height))
    // It grows out of the point it was opened at.
    menuPlace.value = {
      left,
      top,
      originX: Math.max(0, Math.min(width, x - left)),
      originY: Math.max(0, Math.min(height, y - top)),
    }
    menuPlaced.value = true
    // Once shown: a hidden item takes no focus.
    nextTick(() => focusMenuItem(0))
  }

  function closeMenu(restore: boolean): void {
    stopWaiting()
    if (!menuOpen.value)
      return
    menuOpen.value = false
    menuArmed.value = false
    const target = menuReturnFocus
    menuReturnFocus = null
    // Focus leaves with the menu: back where it was, or onto the dialog.
    const active = hasDocument() ? document.activeElement : null
    if (options.live() && (restore || (active && menuRef.value?.contains(active))))
      (target?.isConnected ? target : options.overlay.value)?.focus({ preventScroll: true })
  }

  function chooseFromMenu(action: ImagePreviewAction, reverse: boolean): void {
    if (options.disabled(action))
      return
    // Closed first: the gestures, rotate's among them, wait while it is open.
    closeMenu(true)
    options.run(action, reverse)
  }

  function openMenuFromKeyboard(): boolean {
    const box = options.fitBox()
    return openMenu({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, 'keyboard', false)
  }

  function onContextMenu(event: MouseEvent): void {
    const target = event.target
    if (menuOpen.value || (target instanceof Element && target.closest('.tx-image-preview__menu-layer') !== null)) {
      event.preventDefault()
      return
    }
    // Shift lets the browser's own menu through, as pages with a menu of their own do.
    if (!options.enabled() || event.shiftKey || !options.isPicture(target))
      return
    const pointerType = 'pointerType' in event ? (event as PointerEvent).pointerType : 'mouse'
    const touch = pointerType === 'touch' || pointerType === 'pen'
    // A touch held still asks the gestures for the menu too; the press is the menu's now.
    if (touch)
      options.endPress()
    if (openMenu(options.point(event), touch ? 'touch' : 'pointer', touch || event.buttons !== 0))
      event.preventDefault()
  }

  // The mouse events a touch sends once it lifts land where it began: on the picture, under the
  // menu its long press opened. Focus stays in the menu.
  function onMouseDown(event: MouseEvent): void {
    if (menuOpen.value && !(event.target instanceof Element && event.target.closest('.tx-image-preview__menu')))
      event.preventDefault()
  }

  function onMenuKey(event: KeyboardEvent): void {
    const at = menuItems().indexOf(document.activeElement as HTMLElement)
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        focusMenuItem(at + 1)
        break
      case 'ArrowUp':
        event.preventDefault()
        focusMenuItem(at < 0 ? -1 : at - 1)
        break
      case 'Home':
        event.preventDefault()
        focusMenuItem(0)
        break
      case 'End':
        event.preventDefault()
        focusMenuItem(-1)
        break
      case 'Escape':
      case 'Tab':
        event.preventDefault()
        closeMenu(true)
        break
      case 'ContextMenu':
        event.preventDefault()
        break
      default:
        // Enter and Space press the item; nothing else reaches the picture while the menu is open.
        break
    }
  }

  onBeforeUnmount(stopWaiting)

  return {
    menuOpen,
    menuArmed,
    menuPlaced,
    menuRef,
    menuStyle,
    menuLevel,
    openMenu,
    closeMenu,
    chooseFromMenu,
    openMenuFromKeyboard,
    onContextMenu,
    onMouseDown,
    onMenuKey,
  }
}
