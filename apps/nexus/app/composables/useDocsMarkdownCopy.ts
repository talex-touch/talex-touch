import { toDocsMarkdownPath } from '#shared/utils/docs-markdown'

export type DocsMarkdownCopyState = 'idle' | 'copied' | 'failed'

const COPY_FEEDBACK_MS = 1800

// Nitro types $fetch by server route, and a page's `.md` address is only known
// at runtime, so the call goes through the plain signature.
type FetchText = (request: string, options: { responseType: 'text' }) => Promise<string>

// Kept for the session: pointing at the button starts the request, so the
// click usually finds the source already here. A failed request is dropped,
// and the next attempt asks again.
const markdownSources = new Map<string, Promise<string>>()

let feedbackTimer: ReturnType<typeof setTimeout> | null = null

function loadMarkdownSource(url: string) {
  const cached = markdownSources.get(url)
  if (cached)
    return cached

  // Rejects on a non-2xx answer, so a missing page never reaches the clipboard.
  const pending = ($fetch as unknown as FetchText)(url, { responseType: 'text' })
  markdownSources.set(url, pending)
  pending.catch(() => markdownSources.delete(url))
  return pending
}

/**
 * Safari keeps a clipboard write only while the click that asked for it is
 * still being handled. A ClipboardItem takes a promise, so the write starts
 * inside the click and the text follows when the request lands.
 */
async function writeToClipboard(text: Promise<string>) {
  if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function') {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/plain': text.then(value => new Blob([value], { type: 'text/plain' })) }),
      ])
      return
    }
    catch {
      // Engines without promise-valued items reject here; writeText still
      // works wherever the click's activation outlasts the request.
    }
  }
  await navigator.clipboard.writeText(await text)
}

/** Copies the Markdown source of the current docs page, served at `/<locale>/docs/<path>.md`. */
export function useDocsMarkdownCopy() {
  const { t } = useI18n()
  const { docsLocale, docsPath } = useDocsRoute()
  const sourceUrl = computed(() => toDocsMarkdownPath(docsPath.value, docsLocale.value))
  const state = ref<DocsMarkdownCopyState>('idle')
  const label = computed(() => {
    if (state.value === 'copied')
      return t('docs.aside.copyPromptDone')
    if (state.value === 'failed')
      return t('docs.aside.copyPromptFailed')
    return t('docs.aside.copyPrompt')
  })
  const icon = computed(() => {
    if (state.value === 'copied')
      return 'i-carbon-checkmark'
    if (state.value === 'failed')
      return 'i-carbon-warning-alt'
    return 'i-carbon-copy'
  })
  // Only the outcome is announced; the label alone changes silently under focus.
  const announcement = computed(() => (state.value === 'idle' ? '' : label.value))
  const hint = computed(() => t('docs.aside.copyPromptHint'))

  function clearFeedback() {
    if (feedbackTimer === null)
      return
    clearTimeout(feedbackTimer)
    feedbackTimer = null
  }

  function settle(next: Exclude<DocsMarkdownCopyState, 'idle'>) {
    clearFeedback()
    state.value = next
    feedbackTimer = setTimeout(() => {
      feedbackTimer = null
      state.value = 'idle'
    }, COPY_FEEDBACK_MS)
  }

  function prefetch() {
    if (import.meta.client)
      void loadMarkdownSource(sourceUrl.value).catch(() => {})
  }

  async function copy() {
    if (!import.meta.client)
      return
    try {
      await writeToClipboard(loadMarkdownSource(sourceUrl.value))
      settle('copied')
    }
    catch {
      settle('failed')
    }
  }

  watch(sourceUrl, () => {
    clearFeedback()
    state.value = 'idle'
  })

  return { state, label, icon, announcement, hint, copy, prefetch }
}
