/**
 * The search trigger is server-rendered, so it is on screen well before the app can answer it:
 * the header hydrates about a second after first paint in local dev, and the app only mounts once
 * every async component on the page has loaded, which a cold load over a slow link puts seconds
 * later. A click or shortcut in that window used to do nothing. This script runs from the document
 * head, ahead of the page, and notes what the reader asked for last. app.vue takes the requests
 * over once the palette's place in it has hydrated, long before it mounts, and stops the script
 * once it has mounted.
 */
export type GlobalSearchRequest = 'open' | 'close'

export interface GlobalSearchBoot {
  /** The reader's last request, while no one is answering them yet. */
  intent: GlobalSearchRequest | null
  /** From now on hands each request to `answer`, starting with the pending one, if any. */
  forward: (answer: (request: GlobalSearchRequest) => void) => void
  /** Removes the script's listeners. */
  stop: () => void
}

declare global {
  interface Window {
    __nexusSearchBoot?: GlobalSearchBoot
  }
}

/**
 * Inline source for `app.head`. The shortcut rules mirror `handleGlobalSearchShortcut` in
 * app.vue. Until requests are forwarded, any other click dismisses a pending open, as a click on
 * the backdrop would; after that, the palette is on screen to take its own clicks. The guard
 * keeps a second run, should the head ever be re-rendered on the client, from replacing a boot
 * object app.vue has already stopped.
 */
export const globalSearchBootScript = `(() => {
  if (window.__nexusSearchBoot)
    return
  let answer = null
  const request = (intent) => {
    if (answer)
      answer(intent)
    else
      boot.intent = intent
  }
  const isEditable = target => target instanceof HTMLElement
    && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  const onClick = (event) => {
    if (event.target instanceof Element && event.target.closest('[data-role="global-search-trigger"]'))
      request('open')
    else if (boot.intent === 'open')
      boot.intent = 'close'
  }
  const onKeydown = (event) => {
    if (event.defaultPrevented)
      return
    if (event.key === 'Escape') {
      if (answer || boot.intent === 'open')
        request('close')
      return
    }
    if (isEditable(event.target))
      return
    const key = (event.key || '').toLowerCase()
    const command = (event.metaKey || event.ctrlKey) && key === 'k'
    const slash = !event.metaKey && !event.ctrlKey && !event.altKey && key === '/'
    if (command || slash) {
      event.preventDefault()
      request('open')
    }
  }
  const boot = window.__nexusSearchBoot = {
    intent: null,
    forward(next) {
      answer = next
      const pending = boot.intent
      boot.intent = null
      if (pending)
        answer(pending)
    },
    stop() {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('keydown', onKeydown)
    },
  }
  document.addEventListener('click', onClick, true)
  window.addEventListener('keydown', onKeydown)
})()`
