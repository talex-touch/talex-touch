<script setup lang="ts">
import type { MarkdownEditorComment, MarkdownEditorLabels, MarkdownEditorUser } from './types'
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { TxIcon } from '../../icon'
import { isCommentDetached } from './comment-anchors'
import { peerColor } from './editor-overlay'
import { MARKDOWN_EDITOR_UI_ICONS } from './toolbar-icons'

// Internal: the comment threads beside the text. The editor owns the threads
// and their anchors; this lists them and reports what the user did.
defineOptions({ name: 'TxMarkdownEditorComments' })

const props = defineProps<{
  comments: MarkdownEditorComment[]
  activeId: string | null
  labels: MarkdownEditorLabels
  /** Replying and resolving; false while the editor is disabled. */
  interactive: boolean
}>()

const emit = defineEmits<{
  activate: [id: string]
  reply: [id: string, body: string]
  resolve: [id: string, resolved: boolean]
  delete: [id: string]
  close: []
}>()

const drafts = reactive<Record<string, string>>({})
const list = ref<HTMLElement | null>(null)

const open = computed(() => props.comments
  .filter(comment => !comment.resolved)
  .sort((a, b) => a.from - b.from || a.createdAt - b.createdAt))

const resolved = computed(() => props.comments
  .filter(comment => comment.resolved)
  .sort((a, b) => b.createdAt - a.createdAt))

watch(() => props.activeId, async (id) => {
  if (!id)
    return
  await nextTick()
  const thread = Array.from(list.value?.querySelectorAll<HTMLElement>('[data-comment-id]') ?? [])
    .find(element => element.dataset.commentId === id)
  thread?.scrollIntoView?.({ block: 'nearest' })
})

function initial(user: MarkdownEditorUser): string {
  return Array.from(user.name.trim())[0]?.toUpperCase() ?? '?'
}

function color(user: MarkdownEditorUser): string {
  return user.color || peerColor(user.id)
}

function time(epoch: number): string {
  const date = new Date(epoch)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  try {
    return new Intl.DateTimeFormat(undefined, sameDay
      ? { hour: '2-digit', minute: '2-digit' }
      : { month: 'short', day: 'numeric' }).format(date)
  }
  catch {
    return date.toLocaleString()
  }
}

function sendReply(id: string): void {
  const body = drafts[id]?.trim()
  if (!body)
    return
  emit('reply', id, body)
  drafts[id] = ''
}

function onReplyKeydown(event: KeyboardEvent, id: string): void {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) {
    event.preventDefault()
    sendReply(id)
  }
}
</script>

<template>
  <aside class="tx-markdown-editor-comments" :aria-label="labels.comments">
    <header class="tx-markdown-editor-comments__header">
      <span class="tx-markdown-editor-comments__title">{{ labels.comments }}</span>
      <span v-if="open.length" class="tx-markdown-editor-comments__count">{{ open.length }}</span>
      <button
        type="button"
        class="tx-markdown-editor-comments__icon"
        :aria-label="labels.close"
        :title="labels.close"
        @click="emit('close')"
      >
        <TxIcon :name="MARKDOWN_EDITOR_UI_ICONS.close" :size="14" />
      </button>
    </header>

    <div ref="list" class="tx-markdown-editor-comments__list">
      <p v-if="!comments.length" class="tx-markdown-editor-comments__empty">
        {{ labels.noComments }}
      </p>

      <article
        v-for="comment in open"
        :key="comment.id"
        class="tx-markdown-editor-thread"
        :class="{ 'is-active': comment.id === activeId }"
        :data-comment-id="comment.id"
        @click="emit('activate', comment.id)"
      >
        <blockquote class="tx-markdown-editor-thread__quote">
          {{ comment.quote }}
        </blockquote>
        <p v-if="isCommentDetached(comment)" class="tx-markdown-editor-thread__detached">
          {{ labels.detached }}
        </p>

        <div
          v-for="entry in [comment, ...(comment.replies ?? [])]"
          :key="entry.id"
          class="tx-markdown-editor-thread__entry"
        >
          <span
            class="tx-markdown-editor-thread__avatar"
            :style="{ '--tx-markdown-editor-peer': color(entry.author) }"
            aria-hidden="true"
          >
            <img v-if="entry.author.avatar" :src="entry.author.avatar" alt="">
            <template v-else>{{ initial(entry.author) }}</template>
          </span>
          <div class="tx-markdown-editor-thread__content">
            <div class="tx-markdown-editor-thread__meta">
              <span class="tx-markdown-editor-thread__author">{{ entry.author.name }}</span>
              <time :datetime="new Date(entry.createdAt).toISOString()">{{ time(entry.createdAt) }}</time>
            </div>
            <p class="tx-markdown-editor-thread__body">
              {{ entry.body }}
            </p>
          </div>
        </div>

        <div class="tx-markdown-editor-thread__actions">
          <button
            type="button"
            class="tx-markdown-editor-comments__icon"
            :aria-label="labels.resolve"
            :title="labels.resolve"
            :disabled="!interactive"
            @click.stop="emit('resolve', comment.id, true)"
          >
            <TxIcon :name="MARKDOWN_EDITOR_UI_ICONS.resolve" :size="14" />
          </button>
          <button
            type="button"
            class="tx-markdown-editor-comments__icon"
            :aria-label="labels.delete"
            :title="labels.delete"
            :disabled="!interactive"
            @click.stop="emit('delete', comment.id)"
          >
            <TxIcon :name="MARKDOWN_EDITOR_UI_ICONS.delete" :size="14" />
          </button>
        </div>

        <form
          v-if="interactive && comment.id === activeId"
          class="tx-markdown-editor-thread__reply"
          @submit.prevent="sendReply(comment.id)"
          @click.stop
        >
          <textarea
            v-model="drafts[comment.id]"
            class="tx-markdown-editor-thread__field"
            rows="1"
            :placeholder="labels.replyPlaceholder"
            :aria-label="labels.replyPlaceholder"
            @keydown="onReplyKeydown($event, comment.id)"
          />
          <button
            type="submit"
            class="tx-markdown-editor-thread__send"
            :disabled="!drafts[comment.id]?.trim()"
          >
            {{ labels.replySubmit }}
          </button>
        </form>
      </article>

      <details v-if="resolved.length" class="tx-markdown-editor-comments__resolved">
        <summary>
          <TxIcon :name="MARKDOWN_EDITOR_UI_ICONS.disclosure" :size="12" />
          <span>{{ labels.resolved }}</span>
          <span class="tx-markdown-editor-comments__count">{{ resolved.length }}</span>
        </summary>
        <article
          v-for="comment in resolved"
          :key="comment.id"
          class="tx-markdown-editor-thread is-resolved"
          :class="{ 'is-active': comment.id === activeId }"
          :data-comment-id="comment.id"
        >
          <blockquote class="tx-markdown-editor-thread__quote">
            {{ comment.quote }}
          </blockquote>
          <p class="tx-markdown-editor-thread__body">
            {{ comment.body }}
          </p>
          <div class="tx-markdown-editor-thread__actions">
            <button
              type="button"
              class="tx-markdown-editor-comments__icon"
              :aria-label="labels.reopen"
              :title="labels.reopen"
              :disabled="!interactive"
              @click="emit('resolve', comment.id, false)"
            >
              <TxIcon :name="MARKDOWN_EDITOR_UI_ICONS.reopen" :size="14" />
            </button>
            <button
              type="button"
              class="tx-markdown-editor-comments__icon"
              :aria-label="labels.delete"
              :title="labels.delete"
              :disabled="!interactive"
              @click="emit('delete', comment.id)"
            >
              <TxIcon :name="MARKDOWN_EDITOR_UI_ICONS.delete" :size="14" />
            </button>
          </div>
        </article>
      </details>
    </div>
  </aside>
</template>

<style lang="scss">
.tx-markdown-editor-comments {
  display: flex;
  flex: none;
  flex-direction: column;
  width: 288px;
  min-height: 0;
  border-left: 1px solid var(--tx-markdown-editor-border);
  background: var(--tx-markdown-editor-toolbar-bg);
  color: var(--tx-markdown-editor-text);
  font-size: 13px;
}

.tx-markdown-editor-comments__header {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 8px 0 14px;
  border-bottom: 1px solid var(--tx-markdown-editor-border);
}

.tx-markdown-editor-comments__title {
  font-weight: var(--tx-font-weight-semibold, 600);
}

.tx-markdown-editor-comments__count {
  color: var(--tx-markdown-editor-muted);
  font-variant-numeric: tabular-nums;
}

.tx-markdown-editor-comments__header .tx-markdown-editor-comments__icon {
  margin-left: auto;
}

.tx-markdown-editor-comments__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--tx-markdown-editor-muted);
  cursor: pointer;

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--tx-markdown-editor-text) 8%, transparent);
    color: var(--tx-markdown-editor-text);
  }

  &:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--tx-markdown-editor-accent) 55%, transparent);
    outline-offset: 1px;
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.tx-markdown-editor-comments__list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  padding: 10px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.tx-markdown-editor-comments__empty {
  margin: 0;
  padding: 24px 8px;
  color: var(--tx-markdown-editor-muted);
  line-height: 1.6;
  text-align: center;
}

.tx-markdown-editor-comments__resolved {
  summary {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 4px;
    border-radius: 7px;
    color: var(--tx-markdown-editor-muted);
    font-size: 12px;
    font-weight: var(--tx-font-weight-semibold, 600);
    list-style: none;
    cursor: pointer;

    &::-webkit-details-marker {
      display: none;
    }
  }

  &[open] summary > :first-child {
    transform: rotate(90deg);
  }

  .tx-markdown-editor-thread {
    margin-top: 8px;
  }
}

.tx-markdown-editor-thread {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 10px;
  background: var(--tx-markdown-editor-bg-raised);
  box-shadow: 0 0 0 1px var(--tx-markdown-editor-border);
  cursor: pointer;

  &.is-active {
    box-shadow: 0 0 0 1.5px var(--tx-markdown-editor-comment-ring), var(--tx-elevation-3, 2px 4px 14px rgb(0 0 0 / 6%));
    cursor: default;
  }

  &.is-resolved {
    cursor: default;
    opacity: 0.78;
  }
}

.tx-markdown-editor-thread__quote {
  display: -webkit-box;
  margin: 0;
  padding: 0 0 0 8px;
  overflow: hidden;
  border-left: 2px solid var(--tx-markdown-editor-comment-ring);
  color: var(--tx-markdown-editor-muted);
  font-size: 12px;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.tx-markdown-editor-thread__detached {
  margin: 0;
  color: var(--tx-markdown-editor-muted);
  font-size: 12px;
  font-style: italic;
}

.tx-markdown-editor-thread__entry {
  display: flex;
  gap: 8px;
}

.tx-markdown-editor-thread__avatar {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  overflow: hidden;
  border-radius: 50%;
  background: var(--tx-markdown-editor-peer);
  color: var(--tx-color-white, #fff);
  font-size: 11px;
  font-weight: var(--tx-font-weight-semibold, 600);

  img {
    width: 100%;
    height: 100%;
    margin: 0;
    object-fit: cover;
  }
}

.tx-markdown-editor-thread__content {
  min-width: 0;
}

.tx-markdown-editor-thread__meta {
  display: flex;
  align-items: baseline;
  gap: 6px;
  line-height: 22px;

  time {
    color: var(--tx-markdown-editor-muted);
    font-size: 12px;
  }
}

.tx-markdown-editor-thread__author {
  font-weight: var(--tx-font-weight-semibold, 600);
}

.tx-markdown-editor-thread__body {
  margin: 0;
  line-height: 1.55;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.tx-markdown-editor-thread__actions {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
  margin: -4px -4px -4px 0;
}

.tx-markdown-editor-thread__reply {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  margin: 0;
}

.tx-markdown-editor-thread__field {
  flex: 1;
  min-width: 0;
  min-height: 30px;
  max-height: 120px;
  padding: 5px 8px;
  border: 0;
  border-radius: 7px;
  outline: 0;
  background: var(--tx-markdown-editor-field-bg);
  box-shadow: inset 0 0 0 1px var(--tx-markdown-editor-border);
  color: inherit;
  font: inherit;
  line-height: 20px;
  resize: vertical;

  &::placeholder {
    color: var(--tx-markdown-editor-placeholder);
  }

  &:focus-visible {
    box-shadow: inset 0 0 0 1px var(--tx-markdown-editor-accent);
  }
}

.tx-markdown-editor-thread__send {
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 7px;
  background: var(--tx-markdown-editor-accent);
  color: var(--tx-color-on-primary, #fff);
  font: inherit;
  font-weight: var(--tx-font-weight-semibold, 600);
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--tx-markdown-editor-accent) 55%, transparent);
    outline-offset: 1px;
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .tx-markdown-editor-comments__resolved summary > :first-child {
    transition: transform 0.18s ease;
  }
}
</style>
