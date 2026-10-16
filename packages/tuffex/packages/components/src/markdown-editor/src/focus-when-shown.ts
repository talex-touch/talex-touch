/**
 * Focuses `target` once its popover can take focus, then calls `done`.
 * TxBaseAnchor keeps the panel at `visibility: hidden` until its open motion
 * starts, a few frames after the content mounts (later on the first open,
 * which loads GSAP), and focusing a hidden element does nothing.
 */
export function focusWhenShown(target: () => HTMLElement | null | undefined, done?: () => void, timeout = 2000): void {
  const doc = target()?.ownerDocument
  if (!doc)
    return
  const before = doc.activeElement
  const deadline = performance.now() + timeout
  const attempt = (): void => {
    const element = target()
    // Gone, or focus moved on while the panel opened: the user is elsewhere.
    if (!element?.isConnected || doc.activeElement !== before)
      return
    element.focus({ preventScroll: true })
    if (doc.activeElement === element)
      done?.()
    else if (performance.now() < deadline)
      requestAnimationFrame(attempt)
  }
  attempt()
}
