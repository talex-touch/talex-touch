import type { Ref } from 'vue'
/**
 * Composable for keyboard navigation support
 * Provides arrow key navigation and other keyboard shortcuts
 */
import { onActivated, onDeactivated, onMounted, onUnmounted } from 'vue'

interface KeyboardNavigationOptions {
  /**
   * Callback when user navigates up
   */
  onNavigateUp?: () => void

  /**
   * Callback when user navigates down
   */
  onNavigateDown?: () => void

  /**
   * Callback when user navigates left
   */
  onNavigateLeft?: () => void

  /**
   * Callback when user navigates right
   */
  onNavigateRight?: () => void

  /**
   * Callback when user presses Enter
   */
  onEnter?: () => void

  /**
   * Callback when user presses Space
   */
  onSpace?: () => void

  /**
   * Callback when user presses Escape
   */
  onEscape?: () => void

  /**
   * Element to attach listeners to (defaults to document)
   */
  element?: Ref<HTMLElement | null>

  /**
   * Whether navigation is enabled
   */
  enabled?: Ref<boolean>
}

export function useKeyboardNavigation(options: KeyboardNavigationOptions = {}) {
  const {
    onNavigateUp,
    onNavigateDown,
    onNavigateLeft,
    onNavigateRight,
    onEnter,
    onSpace,
    onEscape,
    element,
    enabled
  } = options

  const handleKeyDown = (event: KeyboardEvent) => {
    // Check if navigation is disabled
    if (enabled && !enabled.value) {
      return
    }

    // Don't interfere with input fields
    const target = event.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return
    }

    switch (event.key) {
      case 'ArrowUp':
        if (!onNavigateUp) return
        event.preventDefault()
        onNavigateUp()
        break
      case 'ArrowDown':
        if (!onNavigateDown) return
        event.preventDefault()
        onNavigateDown()
        break
      case 'ArrowLeft':
        if (!onNavigateLeft) return
        event.preventDefault()
        onNavigateLeft()
        break
      case 'ArrowRight':
        if (!onNavigateRight) return
        event.preventDefault()
        onNavigateRight()
        break
      case 'Enter':
        onEnter?.()
        break
      case ' ':
        if (!onSpace) return
        event.preventDefault()
        onSpace()
        break
      case 'Escape':
        onEscape?.()
        break
    }
  }

  let attachedTarget: HTMLElement | Document | null = null

  const detach = (): void => {
    attachedTarget?.removeEventListener('keydown', handleKeyDown as EventListener)
    attachedTarget = null
  }

  const attach = (): void => {
    const targetElement = element?.value || document
    if (attachedTarget === targetElement) return
    detach()
    targetElement.addEventListener('keydown', handleKeyDown as EventListener)
    attachedTarget = targetElement
  }

  onMounted(attach)
  onActivated(attach)
  onDeactivated(detach)
  onUnmounted(detach)

  return {
    handleKeyDown
  }
}
