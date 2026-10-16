import type { MarkdownEditorLabels, MarkdownEditorUploadImage, MarkdownTextChange } from './types'
import { computed, onBeforeUnmount, shallowRef } from 'vue'
import { MARKDOWN_UPLOAD_PREFIX } from './markdown-render'
import { linkDestination } from './markdown-serializer'

/**
 * Images on their way to the host's storage.
 *
 * A pasted, dropped or picked image goes into the document at once as
 * `![name](#upload-<id>)`, so it has a place that edits and peers move like any
 * other text. The surfaces draw that placeholder as a card with a local preview
 * and the upload's progress; when the host resolves the URL, the placeholder is
 * replaced wherever it now is. Deleting the card cancels its upload.
 */

interface UploadEntry {
  id: string
  file: File
  preview: string | null
  progress: number
  failed: boolean
  controller: AbortController
}

export interface MarkdownUploadsOptions {
  upload: () => MarkdownEditorUploadImage | undefined
  labels: () => MarkdownEditorLabels
  doc: () => string
  /** Puts Markdown in place of `from`–`to` as the user's own edit. */
  insert: (markdown: string, from: number, to: number) => void
  /** A change made on the user's behalf, which undo must not take back. */
  replace: (change: MarkdownTextChange) => void
  /** Elements whose upload cards follow the progress. */
  roots: () => Array<HTMLElement | null | undefined>
  onError: (error: unknown, file: File) => void
}

const PRELOAD_TIMEOUT = 8000

function uploadId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function altText(file: File): string {
  const name = file.name.replace(/\.[^.]+$/, '').replace(/[[\]\\\n]/g, ' ').trim()
  return name || 'image'
}

function placeholderPattern(id: string): RegExp {
  return new RegExp(`!\\[((?:\\\\.|[^\\]\\\\])*)\\]\\(${MARKDOWN_UPLOAD_PREFIX}${id}\\)`)
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&')
}

/** Waits until the hosted image can be drawn, so the card does not give way to an empty frame. */
function preload(url: string): Promise<void> {
  if (typeof Image === 'undefined')
    return Promise.resolve()
  return new Promise((resolve) => {
    const image = new Image()
    const done = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(done, PRELOAD_TIMEOUT)
    image.onload = done
    image.onerror = done
    image.src = url
  })
}

export function useMarkdownUploads(options: MarkdownUploadsOptions) {
  const entries = new Map<string, UploadEntry>()
  /** Bumped on every progress tick, for the status bar. */
  const version = shallowRef(0)

  const summary = computed(() => {
    void version.value
    let active = 0
    let progress = 0
    let failed = 0
    for (const entry of entries.values()) {
      if (entry.failed) {
        failed++
        continue
      }
      active++
      progress += entry.progress
    }
    return { active, failed, progress: active ? Math.round(progress / active) : 0 }
  })

  function paint(card: HTMLElement, entry: UploadEntry | undefined): void {
    const labels = options.labels()
    card.dataset.status = entry?.failed ? 'error' : 'uploading'
    card.dataset.label = entry?.failed ? labels.uploadFailed : labels.uploading
    card.style.setProperty('--tx-markdown-editor-upload-progress', String(entry?.progress ?? 0))
  }

  /** Hydration hook of both surfaces: preview image, progress bar, status. */
  function decorate(card: HTMLElement, id: string): void {
    const entry = entries.get(id)
    const doc = card.ownerDocument
    if (entry?.preview && !card.querySelector('img')) {
      const image = doc.createElement('img')
      image.className = 'tx-markdown-editor__upload-preview'
      image.alt = ''
      image.src = entry.preview
      card.prepend(image)
    }
    if (!card.querySelector('.tx-markdown-editor__upload-bar')) {
      const bar = doc.createElement('span')
      bar.className = 'tx-markdown-editor__upload-bar'
      card.append(bar)
    }
    paint(card, entry)
  }

  function repaint(id: string): void {
    const entry = entries.get(id)
    for (const root of options.roots()) {
      for (const card of Array.from(root?.querySelectorAll<HTMLElement>(`[data-upload-id="${cssEscape(id)}"]`) ?? []))
        paint(card, entry)
    }
    version.value++
  }

  function release(id: string): void {
    const entry = entries.get(id)
    if (!entry)
      return
    entries.delete(id)
    if (entry.preview)
      URL.revokeObjectURL(entry.preview)
    version.value++
  }

  async function run(entry: UploadEntry, upload: MarkdownEditorUploadImage): Promise<void> {
    const { signal } = entry.controller
    try {
      const result = await upload(entry.file, {
        signal,
        onProgress: (percent) => {
          if (signal.aborted || !entries.has(entry.id))
            return
          entry.progress = Math.max(0, Math.min(100, Math.round(percent)))
          repaint(entry.id)
        },
      })
      if (signal.aborted)
        return
      const { url, alt, title } = typeof result === 'string' ? { url: result, alt: undefined, title: undefined } : result
      await preload(url)
      if (signal.aborted)
        return
      const doc = options.doc()
      const match = placeholderPattern(entry.id).exec(doc)
      if (match) {
        // The alt text may have been edited while the image was uploading.
        const label = alt?.replace(/[[\]\\]/g, '\\$&') ?? match[1]!
        const titled = title ? ` "${title.replace(/"/g, '\\"')}"` : ''
        options.replace({ from: match.index, to: match.index + match[0].length, insert: `![${label}](${linkDestination(url)}${titled})` })
      }
      release(entry.id)
    }
    catch (error) {
      if (signal.aborted)
        return
      entry.failed = true
      repaint(entry.id)
      options.onError(error, entry.file)
    }
  }

  /** Starts uploading `files` at source position `at`, in place of what runs on to `to`; false when there is no uploader. */
  function start(files: File[], at: number, to = at): boolean {
    const upload = options.upload()
    const images = files.filter(file => file.type.startsWith('image/'))
    if (!upload || !images.length)
      return false
    const created = images.map((file): UploadEntry => ({
      id: uploadId(),
      file,
      preview: typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : null,
      progress: 0,
      failed: false,
      controller: new AbortController(),
    }))
    for (const entry of created)
      entries.set(entry.id, entry)
    version.value++
    options.insert(created.map(entry => `![${altText(entry.file)}](${MARKDOWN_UPLOAD_PREFIX}${entry.id})`).join('\n'), at, to)
    for (const entry of created)
      void run(entry, upload)
    return true
  }

  /** Cancels the uploads whose placeholder is no longer in `doc`. */
  function prune(doc: string): void {
    if (!entries.size)
      return
    for (const entry of [...entries.values()]) {
      if (doc.includes(`(${MARKDOWN_UPLOAD_PREFIX}${entry.id})`))
        continue
      entry.controller.abort()
      release(entry.id)
    }
  }

  function dispose(): void {
    for (const entry of entries.values()) {
      entry.controller.abort()
      if (entry.preview)
        URL.revokeObjectURL(entry.preview)
    }
    entries.clear()
  }

  onBeforeUnmount(dispose)

  return { start, decorate, prune, summary }
}
