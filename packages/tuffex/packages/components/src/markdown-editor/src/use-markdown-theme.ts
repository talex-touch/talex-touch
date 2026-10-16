import type { MarkdownEditorTheme } from './types'
import { hasDocument } from '@talex-touch/utils/env'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

/** The theme the editor draws in: `theme`, or for `auto` the page's, followed as it changes. */
export function useMarkdownTheme(theme: () => MarkdownEditorTheme | undefined) {
  const autoTheme = ref<'light' | 'dark'>('light')
  let themeObserver: MutationObserver | null = null

  function resolveAutoTheme(): 'light' | 'dark' {
    if (!hasDocument())
      return 'light'

    const root = document.documentElement
    const body = document.body
    const dataTheme = root.getAttribute('data-theme') || body?.getAttribute('data-theme')

    if (dataTheme === 'dark')
      return 'dark'
    if (dataTheme === 'light')
      return 'light'
    if (root.classList.contains('dark') || body?.classList.contains('dark'))
      return 'dark'
    if (root.classList.contains('light') || body?.classList.contains('light'))
      return 'light'

    return 'light'
  }

  function syncAutoTheme() {
    autoTheme.value = resolveAutoTheme()
  }

  function setupThemeObserver() {
    if (!hasDocument() || typeof MutationObserver === 'undefined')
      return

    themeObserver?.disconnect()
    themeObserver = new MutationObserver(() => {
      syncAutoTheme()
    })
    const observerInit: MutationObserverInit = {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    }
    themeObserver.observe(document.documentElement, observerInit)
    // resolveAutoTheme also reads theme signals off <body>, so a body-driven dark-mode
    // toggle has to be observed too — otherwise it silently leaves the editor on the stale
    // theme (the read surface and the watched surface must match).
    if (document.body)
      themeObserver.observe(document.body, observerInit)
  }

  watch(theme, (value) => {
    if (value === 'auto') {
      syncAutoTheme()
      setupThemeObserver()
      return
    }

    themeObserver?.disconnect()
    themeObserver = null
  })

  onMounted(() => {
    if (theme() === 'auto') {
      syncAutoTheme()
      setupThemeObserver()
    }
  })

  onBeforeUnmount(() => {
    themeObserver?.disconnect()
    themeObserver = null
  })

  return computed<'light' | 'dark'>(() => {
    const value = theme() ?? 'auto'
    return value === 'auto' ? autoTheme.value : value
  })
}
